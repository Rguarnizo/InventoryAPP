import io

import pytest
from PIL import Image


def find(client, path, **params):
    return client.get(path, params={"size": 500, **params}).json()["items"]


def product_by_name(client, name):
    return next(p for p in find(client, "/api/products") if p["name"] == name)


def material_by_name(client, name):
    return next(m for m in find(client, "/api/materials") if m["name"] == name)


def test_requires_auth(client):
    del client.headers["Authorization"]
    assert client.get("/api/products").status_code == 401
    assert client.post("/api/auth/login", data={"username": "admin", "password": "mal"}).status_code == 401


def test_seed_costs_match_spreadsheet(seeded):
    products = find(seeded, "/api/products")
    assert len(products) == 58
    manos = product_by_name(seeded, "Manos")
    assert manos["weight_g"] == 940
    assert manos["estimated_cost"] == pytest.approx(1134, abs=1)
    luna_velas = product_by_name(seeded, "Luna Velas")
    assert luna_velas["estimated_cost"] == pytest.approx(4800)
    assert material_by_name(seeded, "Cemento Blanco")["unit_cost"] == pytest.approx(1.676)


def test_sorting_and_search(seeded):
    by_cost = find(seeded, "/api/products", sort="estimated_cost", order="desc")
    costs = [p["estimated_cost"] for p in by_cost]
    assert costs == sorted(costs, reverse=True)
    by_name = [p["name"] for p in find(seeded, "/api/products", sort="name")]
    assert by_name == sorted(by_name)
    assert {p["name"] for p in find(seeded, "/api/products", q="halloween")} >= {"Cuenco Fantasma Halloween"}
    page = seeded.get("/api/products", params={"size": 10, "page": 2}).json()
    assert page["total"] == 58 and len(page["items"]) == 10
    assert seeded.get("/api/products", params={"sort": "password"}).status_code == 400


def test_cost_preview_with_other_wax(seeded):
    luna = seeded.get(f"/api/products/{product_by_name(seeded, 'Luna Velas')['id']}").json()
    palm = next(m for m in seeded.get("/api/mixtures").json() if m["name"] == "Cera de palma")
    res = seeded.post(f"/api/products/{luna['id']}/cost",
                      json={"quantity": 2, "mixture_overrides": {str(luna["components"][0]["id"]): palm["id"]}})
    assert res.status_code == 200
    assert res.json()["total"] == pytest.approx(2 * 160 * 22)


def test_batch_lifecycle(seeded):
    luna = product_by_name(seeded, "Luna")
    res = seeded.post("/api/batches", json={"product_id": luna["id"], "planned_quantity": 10})
    assert res.status_code == 201, res.text
    batch = res.json()
    assert batch["code"].startswith("LN-") and batch["status"] == "planificado"
    qty = {m["material"]["name"]: m["quantity"] for m in batch["materials"]}
    assert qty["Cemento Blanco"] == pytest.approx(3350)
    assert qty["Marmolina"] == pytest.approx(1005)
    assert qty["Arena Silica"] == pytest.approx(2345)

    # Sin stock de materia prima → 409, a menos que se fuerce
    res = seeded.post(f"/api/batches/{batch['id']}/status", json={"status": "en_proceso"})
    assert res.status_code == 409
    assert len(res.json()["detail"]["shortages"]) == 3

    for name, amount in (("Cemento Blanco", 25000), ("Marmolina", 45000), ("Arena Silica", 40000)):
        m = material_by_name(seeded, name)
        assert seeded.post(f"/api/materials/{m['id']}/adjust", json={"type": "compra", "quantity": amount}).status_code == 200

    res = seeded.post(f"/api/batches/{batch['id']}/status", json={"status": "en_proceso"})
    assert res.status_code == 200, res.text
    assert material_by_name(seeded, "Cemento Blanco")["stock"] == pytest.approx(25000 - 3350)
    # No se pueden editar materiales ya descontados
    assert seeded.put(f"/api/batches/{batch['id']}", json={"materials": []}).status_code == 409

    res = seeded.post(f"/api/batches/{batch['id']}/status",
                      json={"status": "terminado", "produced_quantity": 10, "defective_quantity": 2})
    done = res.json()
    assert done["good_quantity"] == 8
    assert done["total_cost"] == pytest.approx(670 * 10 * 1.20675, rel=1e-4)
    assert done["unit_cost"] == pytest.approx(done["total_cost"] / 8)
    assert product_by_name(seeded, "Luna")["stock"] == 8

    # Cancelar revierte todo
    res = seeded.post(f"/api/batches/{batch['id']}/status", json={"status": "cancelado"})
    assert res.status_code == 200
    assert product_by_name(seeded, "Luna")["stock"] == 0
    assert material_by_name(seeded, "Cemento Blanco")["stock"] == pytest.approx(25000)

    # Transición inválida
    assert seeded.post(f"/api/batches/{batch['id']}/status", json={"status": "terminado"}).status_code == 409
    assert seeded.delete(f"/api/batches/{batch['id']}").status_code == 204


def test_batch_force_and_custom_materials(seeded):
    vela = product_by_name(seeded, "Vela Ondas")
    soya = material_by_name(seeded, "Cera de Soya")
    mecha = material_by_name(seeded, "Mecha Madera Delgada")
    res = seeded.post("/api/batches", json={
        "product_id": vela["id"], "planned_quantity": 3, "code": "MI-LOTE",
        "materials": [{"material_id": soya["id"], "quantity": 520}, {"material_id": mecha["id"], "quantity": 3}],
    })
    assert res.status_code == 201
    batch = res.json()
    res = seeded.post(f"/api/batches/{batch['id']}/status", json={"status": "terminado", "force": True})
    assert res.status_code == 200
    assert material_by_name(seeded, "Cera de Soya")["stock"] == pytest.approx(-520)
    assert res.json()["total_cost"] == pytest.approx(520 * 30 + 3 * 180)
    assert seeded.post("/api/batches", json={"product_id": vela["id"], "planned_quantity": 1,
                                             "code": "MI-LOTE"}).status_code == 409


def test_product_crud_and_photo(client):
    m = client.post("/api/materials", json={"name": "Yeso", "unit": "g", "package_quantity": 1000,
                                            "package_price": 5000, "stock": 2000}).json()
    mix = client.post("/api/mixtures", json={"name": "Yeso puro", "type": "otro",
                                             "components": [{"material_id": m["id"], "proportion": 1}]}).json()
    assert mix["cost_per_unit"] == pytest.approx(5)
    res = client.post("/api/products", json={
        "code": "X1", "name": "Prueba", "type": "otro", "sale_price": 10000,
        "components": [{"mixture_id": mix["id"], "quantity": 200}],
    })
    assert res.status_code == 201, res.text
    product = res.json()
    assert product["estimated_cost"] == pytest.approx(1000)
    assert product["margin"] == pytest.approx(0.9)
    assert client.post("/api/products", json={"code": "X1", "name": "Otra"}).status_code == 409

    buf = io.BytesIO()
    Image.new("RGB", (800, 600), "red").save(buf, "PNG")
    res = client.post(f"/api/products/{product['id']}/photo", files={"file": ("a.png", buf.getvalue(), "image/png")})
    assert res.status_code == 200
    assert client.get(res.json()["thumb_url"]).status_code == 200
    bad = client.post(f"/api/products/{product['id']}/photo", files={"file": ("a.png", b"nope", "image/png")})
    assert bad.status_code == 400

    assert client.delete(f"/api/materials/{m['id']}").status_code == 409
    assert client.delete(f"/api/products/{product['id']}").status_code == 204


def test_csv_round_trip(seeded):
    res = seeded.get("/api/export/products")
    assert res.status_code == 200 and "Manos" in res.text
    csv_text = "code;name;type;sale_price;stock\nC07;Manos;concreto;$25.000;4\nZ9;Nuevo;vela;12000;\n;sin código;;;\n"
    res = seeded.post("/api/import/products", files={"file": ("p.csv", csv_text.encode(), "text/csv")})
    body = res.json()
    assert body["created"] == 1 and body["updated"] == 1 and len(body["errors"]) == 1
    manos = product_by_name(seeded, "Manos")
    assert manos["sale_price"] == 25000 and manos["stock"] == 4


def test_dashboard(seeded):
    data = seeded.get("/api/dashboard").json()
    assert data["products"] == 58 and data["currency"] == "COP"
    assert data["molds_investment"] > 0
