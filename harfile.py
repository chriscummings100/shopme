#!/usr/bin/env python3
"""Analyse a Waitrose HAR file to understand the auth flow and API patterns."""

import json
import sys
import base64
from urllib.parse import urlparse

HAR_PATH = r"C:\dev\shopme\recapture.har"

def decode_jwt(token):
    try:
        parts = token.split('.')
        payload = parts[1] + '=='  # pad
        payload = payload.replace('-', '+').replace('_', '/')
        return json.loads(base64.b64decode(payload).decode('utf-8'))
    except Exception as e:
        return {"error": str(e)}

def truncate(s, n=300):
    if s and len(s) > n:
        return s[:n] + f"… [{len(s)} chars]"
    return s

with open(HAR_PATH, encoding='utf-8') as f:
    har = json.load(f)

entries = har['log']['entries']
api_entries = [e for e in entries if 'waitrose.com' in e['request']['url']]

print(f"Total entries: {len(entries)}")
print(f"Waitrose entries: {len(api_entries)}\n")

# Helper to get header value (case-insensitive)
def get_header(headers, name):
    name_lower = name.lower()
    for h in headers:
        if h['name'].lower() == name_lower:
            return h['value']
    return None

# --- 1. Show token/auth related requests ---
print("=" * 70)
print("AUTH-RELATED REQUESTS")
print("=" * 70)

auth_keywords = ['csrf', 'token', 'auth', 'login', 'signin', 'session', 'oauth']
for e in api_entries:
    url = e['request']['url']
    path = urlparse(url).path
    if any(k in path.lower() for k in auth_keywords):
        method = e['request']['method']
        status = e['response']['status']
        req_headers = {h['name']: h['value'] for h in e['request']['headers']}
        res_body = e['response']['content'].get('text', '')
        req_body = e['request'].get('postData', {}).get('text', '')

        print(f"\n{method} {path}  [{status}]")

        # Notable request headers
        for hdr in ['Authorization', 'X-CSRF-TOKEN', 'Cookie', 'Content-Type']:
            val = get_header(e['request']['headers'], hdr)
            if val:
                if hdr == 'Cookie':
                    val = val[:100] + '…' if len(val) > 100 else val
                print(f"  REQ {hdr}: {val}")

        if req_body:
            print(f"  REQ body: {truncate(req_body, 200)}")

        if res_body:
            print(f"  RES body: {truncate(res_body, 400)}")
            # If response looks like it has a JWT, decode it
            try:
                res_json = json.loads(res_body)
                for key in ['accessToken', 'token', 'access_token', 'jwt', 'id_token']:
                    if key in res_json:
                        jwt_val = res_json[key]
                        print(f"  JWT ({key}): {truncate(jwt_val, 80)}")
                        print(f"  JWT payload: {json.dumps(decode_jwt(jwt_val), indent=4)[:400]}")
            except Exception:
                pass

# --- 2. First authenticated API request ---
print("\n" + "=" * 70)
print("FIRST REQUEST WITH AUTHORIZATION HEADER")
print("=" * 70)

for e in api_entries:
    auth = get_header(e['request']['headers'], 'Authorization')
    if auth:
        url = e['request']['url']
        path = urlparse(url).path
        method = e['request']['method']
        status = e['response']['status']
        print(f"\n{method} {path}  [{status}]")
        print(f"  Authorization: {truncate(auth, 120)}")
        if auth.startswith('Bearer '):
            jwt_payload = decode_jwt(auth[7:])
            print(f"  JWT payload: {json.dumps(jwt_payload, indent=4)[:400]}")
        res_body = e['response']['content'].get('text', '')
        print(f"  RES body: {truncate(res_body, 300)}")
        break

# --- 3. Shopping context ---
print("\n" + "=" * 70)
print("SHOPPING-CONTEXT REQUESTS")
print("=" * 70)

found = False
for e in api_entries:
    if 'shopping-context' in e['request']['url']:
        found = True
        url = e['request']['url']
        path = urlparse(url).path
        method = e['request']['method']
        status = e['response']['status']
        auth = get_header(e['request']['headers'], 'Authorization')
        res_body = e['response']['content'].get('text', '')
        print(f"\n{method} {path}  [{status}]")
        print(f"  Authorization: {auth}")
        print(f"  RES body: {truncate(res_body, 400)}")
if not found:
    print("  (none found)")

# --- 4. All unique API paths with their auth status ---
print("\n" + "=" * 70)
print("ALL UNIQUE API PATHS (first 40)")
print("=" * 70)

seen = {}
for e in api_entries:
    path = urlparse(e['request']['url']).path
    method = e['request']['method']
    key = f"{method} {path}"
    if key not in seen:
        auth = get_header(e['request']['headers'], 'Authorization')
        seen[key] = '✓ auth' if auth else '  anon'

for i, (key, auth) in enumerate(seen.items()):
    if i >= 40:
        print(f"  ... and {len(seen) - 40} more")
        break
    print(f"  {auth}  {key}")

# --- 5. All /api/ paths ---
print("\n" + "=" * 70)
print("ALL /api/ PATHS")
print("=" * 70)

api_path_entries = [e for e in api_entries if '/api/' in e['request']['url']]
print(f"Total /api/ requests: {len(api_path_entries)}\n")
seen_api = {}
for e in api_path_entries:
    path = urlparse(e['request']['url']).path
    method = e['request']['method']
    status = e['response']['status']
    key = f"{method} {path}"
    auth = get_header(e['request']['headers'], 'Authorization')
    cookie = get_header(e['request']['headers'], 'Cookie')
    req_body = e['request'].get('postData', {}).get('text', '')
    res_body = e['response']['content'].get('text', '')
    if key not in seen_api:
        seen_api[key] = True
        print(f"  [{status}] {'✓auth' if auth else 'anon '} {key}")
        if auth:
            print(f"         Authorization: {truncate(auth, 100)}")
        if req_body:
            print(f"         REQ: {truncate(req_body, 150)}")
        if res_body:
            print(f"         RES: {truncate(res_body, 200)}")

# --- 6. Cookie set during auth flow ---
print("\n" + "=" * 70)
print("SET-COOKIE HEADERS IN AUTH RESPONSES")
print("=" * 70)

auth_keywords2 = ['csrf', 'token', 'auth', 'login', 'signin', 'session', 'oauth']
for e in api_entries:
    path = urlparse(e['request']['url']).path
    if any(k in path.lower() for k in auth_keywords2):
        for h in e['response']['headers']:
            if h['name'].lower() == 'set-cookie':
                print(f"  {path}: {truncate(h['value'], 120)}")
