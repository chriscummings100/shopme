import json
import shutil
from pathlib import Path

import pytest

import shopping_memory


@pytest.fixture
def memory_dir(request):
    path = Path('.test-memory') / request.node.name
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)
    yield path
    shutil.rmtree(path, ignore_errors=True)


@pytest.mark.unit
def test_empty_memory_summary(memory_dir):
    summary = shopping_memory.build_summary(base_dir=memory_dir)
    assert summary['associations'] == []
    assert summary['recent_corrections'] == []
    assert summary['ignored_events'] == 0


@pytest.mark.unit
def test_record_association_appears_in_summary(memory_dir):
    shopping_memory.record_association(
        phrase='D.Yogurts',
        vendor='waitrose',
        product_id='123:abc',
        product_name='Little Yeos Strawberry Yogurts 6x45g',
        search_term='kids strawberry yogurts',
        timestamp='2026-05-01T10:00:00Z',
        base_dir=memory_dir,
    )

    summary = shopping_memory.build_summary(base_dir=memory_dir)

    assert summary['associations'][0]['phrase_key'] == 'd yogurts'
    candidate = summary['associations'][0]['candidates'][0]
    assert candidate['product_id'] == '123:abc'
    assert candidate['product_name'] == 'Little Yeos Strawberry Yogurts 6x45g'
    assert candidate['score'] == 2.0
    assert candidate['search_terms'] == ['kids strawberry yogurts']


@pytest.mark.unit
def test_repeated_association_increases_score(memory_dir):
    for timestamp in ['2026-05-01T10:00:00Z', '2026-05-08T10:00:00Z']:
        shopping_memory.record_association(
            phrase='d yogurts',
            vendor='waitrose',
            product_id='123:abc',
            product_name='Little Yeos Strawberry Yogurts 6x45g',
            source='accepted_suggestion',
            timestamp=timestamp,
            base_dir=memory_dir,
        )

    summary = shopping_memory.build_summary(base_dir=memory_dir)
    candidate = summary['associations'][0]['candidates'][0]

    assert candidate['score'] == 3.0
    assert candidate['evidence_count'] == 2
    assert candidate['last_seen'] == '2026-05-08T10:00:00Z'


@pytest.mark.unit
def test_rejection_pushes_bad_candidate_out_of_summary(memory_dir):
    shopping_memory.record_association(
        phrase='cuke',
        vendor='waitrose',
        product_id='coke-id',
        product_name='Coca-Cola Original Taste 2L',
        timestamp='2026-05-01T10:00:00Z',
        base_dir=memory_dir,
    )
    shopping_memory.record_rejection(
        phrase='cuke',
        vendor='waitrose',
        wrong_product_id='coke-id',
        wrong_product_name='Coca-Cola Original Taste 2L',
        correct_product_id='cuke-id',
        correct_product_name='Essential Cucumber Each',
        timestamp='2026-05-01T10:05:00Z',
        base_dir=memory_dir,
    )

    summary = shopping_memory.build_summary(base_dir=memory_dir)
    candidates = summary['associations'][0]['candidates']

    assert candidates[0]['product_id'] == 'cuke-id'
    assert all(c['product_id'] != 'coke-id' for c in candidates)
    assert summary['recent_corrections'][0]['avoid'] == 'Coca-Cola Original Taste 2L'


@pytest.mark.unit
def test_vendor_filter_keeps_associations_separate(memory_dir):
    shopping_memory.record_association(
        phrase='bagels',
        vendor='waitrose',
        product_id='waitrose-id',
        product_name='Waitrose Bagels',
        timestamp='2026-05-01T10:00:00Z',
        base_dir=memory_dir,
    )
    shopping_memory.record_association(
        phrase='bagels',
        vendor='sainsburys',
        product_id='sainsburys-id',
        product_name='Sainsbury Bagels',
        timestamp='2026-05-01T10:01:00Z',
        base_dir=memory_dir,
    )

    summary = shopping_memory.build_summary(vendor='sainsburys', base_dir=memory_dir)

    assert len(summary['associations']) == 1
    assert summary['associations'][0]['vendor'] == 'sainsburys'
    assert summary['associations'][0]['candidates'][0]['product_id'] == 'sainsburys-id'


@pytest.mark.unit
def test_explain_matches_normalized_phrase(memory_dir):
    shopping_memory.record_association(
        phrase='D.Yogurts',
        vendor='waitrose',
        product_id='123:abc',
        product_name='Little Yeos Strawberry Yogurts 6x45g',
        timestamp='2026-05-01T10:00:00Z',
        base_dir=memory_dir,
    )

    explanation = shopping_memory.explain('d yogurts', vendor='waitrose', base_dir=memory_dir)

    assert explanation['phrase_key'] == 'd yogurts'
    assert explanation['matches'][0]['candidates'][0]['product_id'] == '123:abc'


@pytest.mark.unit
def test_corrupt_memory_lines_are_ignored(memory_dir):
    path = shopping_memory.events_path(memory_dir)
    path.write_text(
        'not json\n'
        + json.dumps({
            'event': 'resolved',
            'phrase': 'broken',
            'vendor': 'waitrose',
            'source': 'manual',
            'timestamp': '2026-05-01T09:00:00Z',
        })
        + '\n'
        + json.dumps({
            'event': 'resolved',
            'phrase': 'milk',
            'vendor': 'waitrose',
            'product_id': 'milk-id',
            'product_name': 'Semi Skimmed Milk',
            'source': 'manual',
            'timestamp': '2026-05-01T10:00:00Z',
        })
        + '\n',
        encoding='utf-8',
    )

    summary = shopping_memory.build_summary(base_dir=memory_dir)

    assert summary['ignored_events'] == 2
    assert summary['associations'][0]['phrase_key'] == 'milk'
