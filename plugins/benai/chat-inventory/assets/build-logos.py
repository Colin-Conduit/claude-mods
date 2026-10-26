#!/usr/bin/env python3
"""Builds the connector logo table the mod draws.

Run once after changing a source:
  python3 -I assets/build-logos.py /path/to/logo-kit
or set LOGO_KIT_DIR=/path/to/logo-kit and run it with no argument.
The logo kit folder holds logos-color.json and logos.json (brand marks keyed by
slug: a colour viewBox plus inner markup, and a single-colour path plus hex).
Writes assets/logos.json and hooks/logos.ts (the copy the mod imports).
Nothing is fetched at runtime; every mark here is bundled.

Sources:
- logos-color.json and logos.json from the logo kit folder named above.
- assets/src/*.svg: marks taken from each company's own site on 2026-10-15
  (attio.com, fireflies.ai, app.kit.com, circle.so, app.vidiq.com, posthog.com,
  apify.com, higgsfield.ai, anymailfinder.com, composio.dev, firecrawl.dev,
  pipedrive.com).
- Letter badges in the brand colour where no vector mark was reachable.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else os.environ.get('LOGO_KIT_DIR', ''))
if not KIT or not os.path.isdir(KIT):
    sys.exit('Name the logo kit folder: python3 -I assets/build-logos.py /path/to/logo-kit (or set LOGO_KIT_DIR).')

color_kit = json.load(open(f'{KIT}/logos-color.json'))
simple_kit = json.load(open(f'{KIT}/logos.json'))

# key: (source, colour). source is 'color:<k>', 'simple:<k>', 'src:<file>' or 'letter:<L>'.
TABLE = {
    'gmail': ('color:gmail', '#EA4335'),
    'googlecalendar': ('color:googlecalendar', '#4285F4'),
    'googledrive': ('color:googledrive', '#0F9D58'),
    'googlesheets': ('color:googlesheets', '#34A853'),
    'googledocs': ('simple:googledocs', None),
    'google': ('color:google', '#4285F4'),
    'notion': ('color:notion', '#000000'),
    'slack': ('color:slack', '#4A154B'),
    'stripe': ('simple:stripe', '#635BFF'),
    'calendly': ('color:calendly', '#006BFF'),
    'figma': ('color:figma', '#F24E1E'),
    'vercel': ('color:vercel', '#000000'),
    'supabase': ('color:supabase', '#3FCF8E'),
    'make': ('simple:make', None),
    'youtube': ('color:youtube', '#FF0000'),
    'shopify': ('color:shopify', '#7AB55C'),
    'meta': ('color:meta', '#0467DF'),
    'attio': ('src:attio.svg', '#000000'),
    'fireflies': ('src:fireflies.svg', '#6262DE'),
    'kit': ('src:kit.svg', '#1E1E1E'),
    'circle': ('src:circle.svg', '#506CF0'),
    'vidiq': ('src:vidiq.svg', '#2574F5'),
    'posthog': ('src:posthog.svg', '#000000'),
    'apify': ('src:apify.svg', '#246DFF'),
    'higgsfield': ('src:higgsfield.svg', '#030304'),
    'anymailfinder': ('src:anymailfinder.svg', '#0073E6'),
    'composio': ('src:composio.svg', '#000000'),
    'firecrawl': ('src:firecrawl.svg', '#FA5D19'),
    'pipedrive': ('src:pipedrive.svg', '#017737'),
    'pandadoc': ('letter:P', '#248567'),
}


def root_parts(svg: str):
    """viewBox and inner markup of a full <svg> document."""
    svg = re.sub(r'<\?xml.*?\?>|<!DOCTYPE.*?>', '', svg, flags=re.S).strip()
    head = re.match(r'<svg\b[^>]*>', svg, re.S).group(0)
    inner = svg[len(head):svg.rfind('</svg>')]
    vb = re.search(r'viewBox="([^"]+)"', head)
    if vb:
        box = vb.group(1)
    else:
        w = re.search(r'\bwidth="([\d.]+)', head).group(1)
        h = re.search(r'\bheight="([\d.]+)', head).group(1)
        box = f'0 0 {w} {h}'
    fill = re.search(r'\bfill="([^"]+)"', head)
    if fill and fill.group(1) != 'none':
        inner = f'<g fill="{fill.group(1)}">{inner}</g>'
    return box, inner


def tile(box: str, inner: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32" width="32" height="32">'
        '<rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#ffffff" stroke="#d9d9d9"/>'
        f'<svg x="5" y="5" width="22" height="22" viewBox="{box}" preserveAspectRatio="xMidYMid meet">{inner}</svg>'
        '</svg>'
    )


def letter(ch: str, colour: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">'
        f'<rect width="32" height="32" rx="8" fill="{colour}"/>'
        '<text x="16" y="21.5" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" '
        f'font-size="16" font-weight="700" fill="#ffffff">{ch}</text>'
        '</svg>'
    )


out = {}
for key, (src, colour) in TABLE.items():
    kind, ref = src.split(':', 1)
    if kind == 'color':
        c = color_kit[ref]
        svg = tile(c['viewBox'], c['inner'])
    elif kind == 'simple':
        s = simple_kit[ref]
        colour = colour or s['hex']
        svg = tile('0 0 24 24', f'<path fill="{s["hex"]}" d="{s["d"]}"/>')
    elif kind == 'src':
        box, inner = root_parts(open(os.path.join(HERE, 'src', ref)).read())
        svg = tile(box, inner)
    else:
        svg = letter(ref, colour)
    svg = re.sub(r'<title>.*?</title>', '', svg, flags=re.S)
    svg = re.sub(r'>\s+<', '><', svg)
    assert len(svg) < 131072, key
    out[key] = {'svg': svg, 'color': colour.upper(), 'real': kind != 'letter'}

json.dump(out, open(os.path.join(HERE, 'logos.json'), 'w'), indent=1)
ts = (
    '// Generated by assets/build-logos.py. Do not edit by hand.\n'
    'export type Logo = { svg: string; color: string; real: boolean }\n'
    f'export const LOGOS: Record<string, Logo> = {json.dumps(out)}\n'
)
open(os.path.join(HERE, '..', 'hooks', 'logos.ts'), 'w').write(ts)
print(f'{len(out)} logos, {sum(len(v["svg"]) for v in out.values())} chars')
