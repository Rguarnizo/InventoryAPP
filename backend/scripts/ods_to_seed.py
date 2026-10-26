"""Genera app/seed/initial_data.json a partir del content.xml de Informacion.ods.

Uso: unzip -p Informacion.ods content.xml > /tmp/content.xml
     python scripts/ods_to_seed.py /tmp/content.xml app/seed/initial_data.json
"""
import json, sys, xml.etree.ElementTree as ET
ns = {'table': 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
      'text': 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
      'office': 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'}
T = '{%s}' % ns['table']; O = '{%s}' % ns['office']

def sheets(path):
    out = {}
    for t in ET.parse(path).getroot().iter(T + 'table'):
        rows = []
        for r in t.iter(T + 'table-row'):
            cells = []
            for c in r:
                rep = min(int(c.get(T + 'number-columns-repeated', '1')), 30)
                v = c.get(O + 'value')
                txt = ' '.join(''.join(p.itertext()) for p in c.findall('text:p', ns)).strip()
                cells += [float(v) if v is not None else txt] * rep
            while cells and cells[-1] in ('', None): cells.pop()
            if cells: rows.append(cells)
        out[t.get(T + 'name')] = rows
    return out

def num(v):
    if isinstance(v, float): return v
    v = (v or '').replace('$', '').replace(',', '').replace('.', '').strip()
    return float(v) if v else None

def col(row, i):
    return row[i] if i < len(row) else ''

sh = sheets(sys.argv[1])
units = {'Mecha Madera Delgada': 'unidad', 'Mecha Madera Grande': 'unidad', 'Rollo Mecha': 'unidad'}
materials = []
for r in sh['Materia Prima'][1:]:
    name = r[0].strip()
    unit = units.get(name, 'g')
    qty = num(r[1])
    materials.append({'name': name, 'unit': unit,
                      'package_quantity': qty if unit == 'unidad' else qty * 1000,
                      'package_price': num(r[2]), 'min_stock': 0, 'stock': 0,
                      'proportion': (col(r, 5) if isinstance(col(r, 5), float) else float(str(col(r, 5)).replace(',', '.'))) if col(r, 5) != '' else None})

mixtures = [
    {'name': 'Concreto estándar', 'type': 'concreto',
     'notes': 'Proporción por peso de la hoja Materia Prima (columna Receta). El agua no se costea.',
     'components': [{'material': m['name'], 'proportion': m['proportion']} for m in materials if m['proportion']]},
    {'name': 'Cera de Soya', 'type': 'cera', 'components': [{'material': 'Cera de Soya', 'proportion': 1}]},
    {'name': 'Parafina Refinada', 'type': 'cera', 'components': [{'material': 'Parafina Refinada', 'proportion': 1}]},
    {'name': 'Cera de palma', 'type': 'cera', 'components': [{'material': 'Cera de palma', 'proportion': 1}]},
]
for m in materials: m.pop('proportion')

def category(name):
    low = name.lower()
    if 'halloween' in low or 'fantasma' in low or 'calabaza' in low: return 'Halloween'
    if 'navideñ' in low: return 'Navidad'
    if 'corazón' in low: return 'Amor'
    return None

products = []
for r in sh['Figuras Concreto'][1:]:
    if not isinstance(r[0], float): continue
    water = num(col(r, 3))
    products.append({
        'code': f"C{int(r[0]):02d}", 'name': r[1].strip(), 'type': 'concreto', 'category': category(r[1]),
        'can_be_candle': str(r[2]).strip().lower().startswith('s'),
        'water_weight_ml': water, 'mold_price': num(col(r, 10)),
        'min_price': num(col(r, 6)), 'max_price': num(col(r, 7)),
        'components': [{'mixture': 'Concreto estándar', 'quantity': water * 2}] if water else [],
    })
for r in sh['Hoja3'][1:]:
    if not isinstance(r[0], float): continue
    wax = num(col(r, 3))
    products.append({
        'code': f"V{int(r[0]):02d}", 'name': r[1].strip(), 'type': 'vela', 'category': category(r[1]),
        'can_be_candle': False, 'water_weight_ml': None, 'mold_price': num(col(r, 2)),
        'min_price': num(col(r, 7)), 'max_price': num(col(r, 8)),
        'components': [{'mixture': 'Cera de Soya', 'quantity': wax}] if wax else [],
    })
json.dump({'source': 'Informacion.ods', 'materials': materials, 'mixtures': mixtures, 'products': products},
          open(sys.argv[2], 'w'), ensure_ascii=False, indent=2)
print(len(materials), len(mixtures), len(products))
