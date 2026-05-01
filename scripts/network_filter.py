#!/usr/bin/env python3
"""
network_filter.py — Filter and summarise raw network request output from the
Chrome DevTools MCP `list_network_requests` tool.

Reads the raw text dump, strips third-party noise, and writes a compact JSON
summary suitable for loading into an AI context window.

Usage:
    python network_filter.py --input raw_requests.txt --output summary.json [--domain example.com]
"""

import argparse
import json
import re
import sys
from urllib.parse import urlparse


# Well-known third-party noise domains (analytics, CDN, ads, error tracking)
NOISE_PATTERNS = [
    r'google-analytics\.com',
    r'googletagmanager\.com',
    r'doubleclick\.net',
    r'googlesyndication\.com',
    r'google\.com/pagead',
    r'facebook\.(net|com)',
    r'fbcdn\.net',
    r'twitter\.com',
    r'segment\.(com|io)',
    r'mixpanel\.com',
    r'amplitude\.com',
    r'hotjar\.com',
    r'fullstory\.com',
    r'intercom\.(io|com)',
    r'zendesk\.com',
    r'sentry\.io',
    r'bugsnag\.com',
    r'newrelic\.com',
    r'datadoghq\.com',
    r'akamaized\.net',
    r'akamaitechnologies\.com',
    r'cloudfront\.net',
    r'fastly\.net',
    r'jsdelivr\.net',
    r'unpkg\.com',
    r'cdnjs\.cloudflare\.com',
]

NOISE_RE = re.compile('|'.join(NOISE_PATTERNS), re.IGNORECASE)

# Headers worth extracting for auth analysis
AUTH_HEADERS = {
    'authorization', 'x-csrf-token', 'x-api-key', 'x-auth-token',
    'x-session-token', 'x-access-token', 'x-requested-with',
    'cookie', 'set-cookie',
}


def is_noise(url: str) -> bool:
    return bool(NOISE_RE.search(url))


def parse_request_list(text: str) -> list[dict]:
    """
    Parse the text output from list_network_requests.

    Tries JSON first, then falls back to regex line parsing.
    The MCP tool output format is not guaranteed, so we handle both.
    """
    # Try JSON
    text = text.strip()
    if text.startswith('[') or text.startswith('{'):
        try:
            data = json.loads(text)
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and 'requests' in data:
                return data['requests']
        except json.JSONDecodeError:
            pass

    # Regex: match lines like  "123  GET  https://...  200  fetch"
    # Also handles MCP tool format: "reqid=123 GET https://... [200]"
    # Tolerates markdown table formatting and varying whitespace
    requests = []
    # MCP tool format: reqid=NNN METHOD URL [STATUS]
    mcp_re = re.compile(
        r'reqid=(\d+)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+\[(\d{3}|-)\]',
        re.IGNORECASE,
    )
    line_re = re.compile(
        r'(\d+)\s+\|?\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\|?\s*(\S+)\s+\|?\s*(\d{3}|-)\s*\|?\s*(\S*)',
        re.IGNORECASE,
    )
    for line in text.splitlines():
        m = mcp_re.search(line)
        if m:
            reqid, method, url, status = m.groups()
            requests.append({
                'reqid': int(reqid),
                'method': method.upper(),
                'url': url,
                'status': int(status) if status != '-' else None,
                'type': '',
            })
            continue
        m = line_re.search(line)
        if m:
            reqid, method, url, status, rtype = m.groups()
            requests.append({
                'reqid': int(reqid),
                'method': method.upper(),
                'url': url,
                'status': int(status) if status != '-' else None,
                'type': rtype.strip('|').strip() if rtype else '',
            })
    return requests


def normalise_path(url: str) -> str:
    """Replace IDs in paths with placeholders for grouping."""
    path = urlparse(url).path
    path = re.sub(r'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '/{uuid}', path)
    path = re.sub(r'/\d{6,}', '/{id}', path)
    return path


def classify(requests: list[dict], target_domain: str | None) -> dict:
    first_party = []
    third_party = []
    noise_domains = set()

    for r in requests:
        url = r.get('url', '')
        if not url:
            continue

        if is_noise(url):
            noise_domains.add(urlparse(url).hostname or url)
            continue

        host = urlparse(url).hostname or ''
        if target_domain and host:
            is_first = target_domain in host or host in target_domain
        else:
            is_first = True  # no domain filter → include everything

        entry = {
            'reqid': r.get('reqid'),
            'method': r.get('method', '?'),
            'url': url,
            'status': r.get('status'),
            'type': r.get('type', ''),
            'path_pattern': normalise_path(url),
        }

        if is_first:
            first_party.append(entry)
        else:
            third_party.append(entry)

    return {
        'total_parsed': len(requests),
        'noise_filtered': len(noise_domains),
        'noise_domains': sorted(noise_domains),
        'first_party': first_party,
        'third_party': third_party,
    }


def main():
    parser = argparse.ArgumentParser(description='Filter and summarise Chrome DevTools network dump')
    parser.add_argument('--input', required=True, help='Path to raw_requests.txt from list_network_requests')
    parser.add_argument('--output', required=True, help='Path to write summary.json')
    parser.add_argument('--domain', help='Primary domain (e.g. example.com) to treat as first-party')
    args = parser.parse_args()

    try:
        with open(args.input, encoding='utf-8') as f:
            text = f.read()
    except FileNotFoundError:
        print(f'ERROR: Input file not found: {args.input}', file=sys.stderr)
        sys.exit(1)

    requests = parse_request_list(text)

    if not requests:
        print(
            f'WARNING: No requests parsed from {args.input}.\n'
            'Check that the file contains output from list_network_requests.',
            file=sys.stderr,
        )

    summary = classify(requests, args.domain)

    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)

    fp = len(summary['first_party'])
    tp = len(summary['third_party'])
    noise = summary['noise_filtered']
    print(
        f'Parsed {summary["total_parsed"]} requests → '
        f'{fp} first-party, {tp} third-party, {noise} noise domains filtered'
    )
    if summary['first_party']:
        print('\nFirst-party requests:')
        for r in summary['first_party']:
            status = r['status'] or '-'
            print(f"  [{status}] {r['method']:6} reqid={r['reqid']}  {r['path_pattern']}")


if __name__ == '__main__':
    main()
