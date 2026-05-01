from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MEMORY_ENV = 'SHOPME_MEMORY_DIR'
EVENTS_FILE = 'associations.jsonl'
SUMMARY_FILE = 'summary.json'

POSITIVE_WEIGHTS = {
    'auto_added': 0.5,
    'accepted_suggestion': 1.5,
    'user_selected': 2.0,
    'correction': 2.5,
    'manual': 1.0,
}
REJECTION_WEIGHT = -3.0


def memory_dir() -> Path:
    override = os.environ.get(MEMORY_ENV)
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / '.shopme-memory'


def events_path(base_dir: Path | None = None) -> Path:
    return (base_dir or memory_dir()) / EVENTS_FILE


def summary_path(base_dir: Path | None = None) -> Path:
    return (base_dir or memory_dir()) / SUMMARY_FILE


def phrase_key(phrase: str) -> str:
    key = re.sub(r'[^a-z0-9]+', ' ', phrase.casefold())
    return re.sub(r'\s+', ' ', key).strip()


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def _product_key(product_id: str | None, product_name: str | None) -> str:
    if product_id:
        return f'id:{product_id}'
    if product_name:
        return f'name:{phrase_key(product_name)}'
    raise ValueError('product_id or product_name is required')


def _append_event(event: dict[str, Any], base_dir: Path | None = None) -> dict[str, Any]:
    path = events_path(base_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a', encoding='utf-8') as f:
        f.write(json.dumps(event, sort_keys=True))
        f.write('\n')
    write_summary(base_dir=base_dir)
    return event


def load_events(base_dir: Path | None = None) -> tuple[list[dict[str, Any]], int]:
    path = events_path(base_dir)
    if not path.exists():
        return [], 0

    events: list[dict[str, Any]] = []
    ignored = 0
    with path.open('r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                ignored += 1
                continue
            if not isinstance(event, dict) or not event.get('phrase'):
                ignored += 1
                continue
            event.setdefault('phrase_key', phrase_key(str(event['phrase'])))
            event.setdefault('timestamp', None)
            events.append(event)
    return events, ignored


def record_association(
    *,
    phrase: str,
    vendor: str,
    product_id: str,
    product_name: str,
    search_term: str | None = None,
    source: str = 'user_selected',
    size: str | None = None,
    price: str | None = None,
    timestamp: str | None = None,
    base_dir: Path | None = None,
) -> dict[str, Any]:
    if source not in POSITIVE_WEIGHTS:
        raise ValueError(f'Unknown memory source: {source}')
    event = {
        'event': 'resolved',
        'phrase': phrase,
        'phrase_key': phrase_key(phrase),
        'vendor': vendor,
        'product_id': product_id,
        'product_name': product_name,
        'search_term': search_term,
        'source': source,
        'size': size,
        'price': price,
        'timestamp': timestamp or _now(),
    }
    return _append_event(_without_none(event), base_dir=base_dir)


def record_rejection(
    *,
    phrase: str,
    vendor: str,
    wrong_product_id: str | None = None,
    wrong_product_name: str | None = None,
    correct_product_id: str | None = None,
    correct_product_name: str | None = None,
    source: str = 'correction',
    timestamp: str | None = None,
    base_dir: Path | None = None,
) -> dict[str, Any]:
    if not wrong_product_id and not wrong_product_name:
        raise ValueError('wrong_product_id or wrong_product_name is required')
    event = {
        'event': 'rejected',
        'phrase': phrase,
        'phrase_key': phrase_key(phrase),
        'vendor': vendor,
        'wrong_product_id': wrong_product_id,
        'wrong_product_name': wrong_product_name,
        'correct_product_id': correct_product_id,
        'correct_product_name': correct_product_name,
        'source': source,
        'timestamp': timestamp or _now(),
    }
    return _append_event(_without_none(event), base_dir=base_dir)


def build_summary(
    *,
    vendor: str | None = None,
    limit: int = 3,
    base_dir: Path | None = None,
) -> dict[str, Any]:
    events, ignored = load_events(base_dir)
    ignored_events = ignored
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    recent_corrections: list[dict[str, Any]] = []

    for event in events:
        event_vendor = event.get('vendor')
        if vendor and event_vendor != vendor:
            continue
        pkey = event['phrase_key']
        group_key = (pkey, event_vendor or '')
        group = groups.setdefault(group_key, {
            'phrase': event.get('phrase'),
            'phrase_key': pkey,
            'vendor': event_vendor,
            'candidates': {},
        })
        group['phrase'] = event.get('phrase') or group['phrase']

        if event.get('event') == 'resolved':
            try:
                candidate = _candidate(group, event.get('product_id'), event.get('product_name'))
            except ValueError:
                ignored_events += 1
                continue
            candidate['score'] += POSITIVE_WEIGHTS.get(event.get('source'), 1.0)
            candidate['evidence_count'] += 1
            _update_candidate(candidate, event)

        if event.get('event') == 'rejected':
            try:
                wrong_key = _product_key(event.get('wrong_product_id'), event.get('wrong_product_name'))
            except ValueError:
                ignored_events += 1
                continue
            wrong = group['candidates'].setdefault(wrong_key, _new_candidate(
                event.get('wrong_product_id'), event.get('wrong_product_name')
            ))
            wrong['score'] += REJECTION_WEIGHT
            wrong['reject_count'] += 1
            wrong['last_seen'] = event.get('timestamp') or wrong.get('last_seen')

            if event.get('correct_product_id') or event.get('correct_product_name'):
                correct = _candidate(group, event.get('correct_product_id'), event.get('correct_product_name'))
                correct['score'] += POSITIVE_WEIGHTS['correction']
                correct['evidence_count'] += 1
                _update_candidate(correct, event, correct=True)

            recent_corrections.append(_without_none({
                'phrase': event.get('phrase'),
                'phrase_key': pkey,
                'vendor': event_vendor,
                'avoid': event.get('wrong_product_name') or event.get('wrong_product_id'),
                'prefer': event.get('correct_product_name') or event.get('correct_product_id'),
                'timestamp': event.get('timestamp'),
            }))

    associations = []
    for group in groups.values():
        candidates = [
            _format_candidate(candidate)
            for candidate in group['candidates'].values()
            if candidate['score'] > 0
        ]
        candidates.sort(key=lambda c: (c['score'], c.get('last_seen') or ''), reverse=True)
        if candidates:
            associations.append({
                'phrase': group['phrase'],
                'phrase_key': group['phrase_key'],
                'vendor': group['vendor'],
                'candidates': candidates[:limit],
            })

    associations.sort(key=lambda a: (a['phrase_key'], a.get('vendor') or ''))
    recent_corrections.sort(key=lambda c: c.get('timestamp') or '', reverse=True)

    return {
        'version': 1,
        'generated_at': _now(),
        'associations': associations,
        'recent_corrections': recent_corrections[:10],
        'ignored_events': ignored_events,
    }


def explain(
    phrase: str,
    *,
    vendor: str | None = None,
    limit: int = 5,
    base_dir: Path | None = None,
) -> dict[str, Any]:
    target_key = phrase_key(phrase)
    summary = build_summary(vendor=vendor, limit=limit, base_dir=base_dir)
    matches = [a for a in summary['associations'] if a['phrase_key'] == target_key]
    corrections = [c for c in summary['recent_corrections'] if c['phrase_key'] == target_key]
    return {
        'phrase': phrase,
        'phrase_key': target_key,
        'matches': matches,
        'recent_corrections': corrections,
    }


def write_summary(base_dir: Path | None = None) -> dict[str, Any]:
    summary = build_summary(base_dir=base_dir)
    path = summary_path(base_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding='utf-8')
    return summary


def _candidate(group: dict[str, Any], product_id: str | None, product_name: str | None) -> dict[str, Any]:
    key = _product_key(product_id, product_name)
    candidate = group['candidates'].setdefault(key, _new_candidate(product_id, product_name))
    if product_id:
        candidate['product_id'] = product_id
    if product_name:
        candidate['product_name'] = product_name
    return candidate


def _new_candidate(product_id: str | None, product_name: str | None) -> dict[str, Any]:
    return {
        'product_id': product_id,
        'product_name': product_name,
        'score': 0.0,
        'evidence_count': 0,
        'reject_count': 0,
        'last_seen': None,
        'search_terms': [],
        'sizes': [],
        'prices': [],
    }


def _update_candidate(candidate: dict[str, Any], event: dict[str, Any], correct: bool = False) -> None:
    candidate['last_seen'] = event.get('timestamp') or candidate.get('last_seen')
    if correct:
        return
    for source_key, target_key in [('search_term', 'search_terms'), ('size', 'sizes'), ('price', 'prices')]:
        value = event.get(source_key)
        if value and value not in candidate[target_key]:
            candidate[target_key].append(value)


def _format_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    formatted = {
        'product_id': candidate.get('product_id'),
        'product_name': candidate.get('product_name'),
        'score': round(candidate['score'], 3),
        'evidence_count': candidate['evidence_count'],
        'reject_count': candidate['reject_count'],
        'last_seen': candidate.get('last_seen'),
        'search_terms': candidate.get('search_terms') or None,
        'sizes': candidate.get('sizes') or None,
        'prices': candidate.get('prices') or None,
    }
    return _without_none(formatted)


def _without_none(value: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in value.items() if v is not None}
