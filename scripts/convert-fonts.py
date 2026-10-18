"""Lossless TTF -> WOFF2 packaging; requires fontTools, plus Brotli or Node.js.

Run from any directory: python scripts/convert-fonts.py [--report path.json]
No subsetting, glyph changes, network access, or production Python dependency.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

from fontTools.ttLib import TTFont, woff2

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--node', default='node', help='Node executable for built-in Brotli fallback')
parser.add_argument('--report', type=Path, help='Optional verification and size report')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]


def node_brotli(data, *, mode=0, decode=False):
    """Supply only the two Brotli calls used by fontTools, via Node's standard library."""
    operation = 'brotliDecompressSync(input)' if decode else (
        'brotliCompressSync(input,{params:{[z.constants.BROTLI_PARAM_MODE]:Number(process.argv[1])}})')
    code = "const z=require('node:zlib');const input=require('node:fs').readFileSync(0);process.stdout.write(z." + operation + ');'
    return subprocess.run([args.node, '-e', code, str(mode)], input=data,
                          capture_output=True, check=True).stdout


if not woff2.haveBrotli:
    woff2.brotli = SimpleNamespace(MODE_FONT=2, MODE_TEXT=1,
                                  compress=node_brotli,
                                  decompress=lambda data: node_brotli(data, decode=True))
    woff2.haveBrotli = True


def cmap(font):
    return [(table.platformID, table.platEncID, table.language, table.format, table.cmap)
            for table in font['cmap'].tables]


def verify(original, converted):
    assert original.getGlyphOrder() == converted.getGlyphOrder(), 'glyph order changed'
    # WOFF2 omits an empty digital-signature table; no signed data is discarded.
    if 'DSIG' in original:
        assert original['DSIG'].usNumSigs == 0, 'source has signatures: inspect before converting'
    assert set(original.keys()) - {'DSIG'} == set(converted.keys()), (
        f'table inventory changed: {set(original.keys()) ^ set(converted.keys())}')
    assert cmap(original) == cmap(converted), 'character mapping changed'
    assert original['hmtx'].metrics == converted['hmtx'].metrics, 'advance widths/bearings changed'
    for name in original.getGlyphOrder():
        left = original['glyf'][name].getCoordinates(original['glyf'])
        right = converted['glyf'][name].getCoordinates(converted['glyf'])
        assert list(left[0]) == list(right[0]), f'{name}: outline changed'
        assert left[1:] == right[1:], f'{name}: contours/flags changed'
    for tag in original.keys():
        if tag not in ('GlyphOrder', 'head', 'loca', 'glyf', 'DSIG'):
            assert original.getTableData(tag) == converted.getTableData(tag), f'{tag} changed'
    for field in ('unitsPerEm', 'xMin', 'yMin', 'xMax', 'yMax', 'macStyle', 'lowestRecPPEM'):
        assert getattr(original['head'], field) == getattr(converted['head'], field), field


out = root / 'fonts'
out.mkdir(exist_ok=True)
report = []
for style in ('Regular', 'Bold'):
    source = root / 'imagens-e-documentacao/documentacao/fonts' / f'Luciole-{style}.ttf'
    destination = out / f'Luciole-{style}.woff2'
    font = TTFont(source, recalcTimestamp=False, recalcBBoxes=False)
    font.flavor = 'woff2'
    font.save(destination)
    original = TTFont(source, recalcTimestamp=False, recalcBBoxes=False)
    converted = TTFont(destination, recalcTimestamp=False, recalcBBoxes=False)
    verify(original, converted)
    before, after = source.stat().st_size, destination.stat().st_size
    report.append({
        'font': f'Luciole-{style}', 'source_bytes': before, 'woff2_bytes': after,
        'reduction_percent': round((1 - after / before) * 100, 2),
        'glyphs': len(original.getGlyphOrder()), 'verified': True,
        'source_table_count': len(original.reader.tables),
        'woff2_table_count': len(converted.reader.tables),
        'checks': ['glyph order', 'all cmap subtables', 'glyph outlines/contours',
                   'horizontal metrics', 'non-transformed table bytes', 'head metrics'],
        'packaging_note': 'WOFF2 omits the original empty DSIG table (zero signatures).',
        'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'woff2_sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
        'license_metadata': sorted({n.toUnicode() for n in original['name'].names
                                    if n.nameID in (0, 13, 14)})
    })
    original.close()
    converted.close()
    font.close()
text = json.dumps(report, ensure_ascii=False, indent=2)
if args.report:
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(text + '\n', encoding='utf-8')
print(text)
