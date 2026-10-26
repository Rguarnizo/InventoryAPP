# Luci Notturne · Inventario y lotes de producción

Aplicación web para gestionar el catálogo de productos (figuras de concreto, velas…), la materia prima, las mezclas (fórmulas) y los lotes de producción, con costeo automático.

- **Productos**: foto, código, tipo, categoría, precios mín./máx./venta, precio del molde, stock y una **receta** por unidad. Se muestran en una tabla ordenable y filtrable, con columnas configurables.
- **Materia prima**: presentación de compra (ej. bulto de 25 kg por $41.900), costo por g/ml/unidad calculado, stock, mínimo y alertas. Registra compras y ajustes.
- **Mezclas**: fórmulas reutilizables por proporción (ej. *Concreto estándar* = cemento 1 : marmolina 0,3 : arena 0,7; *Cera de soya*). El costo por gramo se calcula solo.
- **Lotes**: pueden incluir **varios productos** (figuras y velas). La materia prima se precarga sumando sus recetas y se puede ajustar; la mezcla de cada producto se puede cambiar (ej. otra cera). Pasan por los estados planificado → en proceso → terminado o cancelado: la materia prima se descuenta al iniciar, las unidades buenas de cada producto se suman al stock al terminar, y cancelar revierte todo. El costo real se congela al consumir y se reparte entre los productos según su costo estimado por receta, así cada uno tiene su costo unitario real. Cada lote muestra además la **ganancia si se vende completo**: unidades buenas (o planificadas, si no ha terminado) por el precio de venta o el mínimo, con el rango entre precio mínimo y máximo.
- **Importar/Exportar CSV** de productos y materia prima (compatible con LibreOffice/Excel) y exportación de lotes.
- Datos iniciales cargados desde `Informacion.ods`: 10 materiales, 4 mezclas, 27 figuras de concreto y 31 velas.

## Arquitectura

```
navegador ──► frontend (nginx + React)  :APP_PORT
                 ├── /api/*     ─► backend (FastAPI)  ─► db (PostgreSQL 16)
                 └── /uploads/* ─► backend (fotos en el volumen "uploads")
```

| Carpeta     | Contenido                                                                 |
|-------------|---------------------------------------------------------------------------|
| `backend/`  | FastAPI, SQLAlchemy 2, Alembic, JWT, Pillow (miniaturas), pytest          |
| `frontend/` | React 18, TypeScript, Vite, Mantine 7, TanStack Query, React Router       |

## Puesta en marcha (Docker Compose)

```bash
cp .env.example .env      # y cambia contraseñas / JWT_SECRET
docker compose up -d --build
```

Abre `http://localhost:8085` (o el puerto de `APP_PORT`) e ingresa con `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
La documentación interactiva de la API queda en `http://localhost:8085/api/docs`.

Al primer arranque el backend aplica las migraciones, crea el usuario admin y, si la base está vacía y `SEED_INITIAL_DATA=true`, carga los datos de `backend/app/seed/initial_data.json`.

### Despliegue con Portainer (stack desde Git)

1. En Portainer: **Stacks → Add stack → Repository**.
2. **Repository URL**: la URL del repositorio en GitHub. Si es privado, activa *Authentication* con tu usuario y un *Personal Access Token* con permiso de lectura.
3. **Repository reference**: `refs/heads/main`. **Compose path**: `docker-compose.yml`.
4. En **Environment variables** define como mínimo `JWT_SECRET`, `ADMIN_PASSWORD` y `POSTGRES_PASSWORD`. Opcionalmente define `APP_PORT`, `ADMIN_USERNAME` y `CURRENCY`. Puedes usar *Load variables from .env file* con una copia editada de `.env.example`.
5. **Deploy the stack**. Portainer clona el repositorio y construye las imágenes en el propio servidor; la primera vez tarda unos minutos.
6. Abre `http://<ip-del-servidor>:8085`.

Para actualizar después de subir cambios a GitHub, usa **Pull and redeploy** en el stack, o activa *GitOps updates*. Los datos y fotos se guardan en los volúmenes `pgdata` y `uploads`, así que no se pierden al redesplegar.

Si Docker corre dentro de un **LXC de Proxmox**, el contenedor necesita `features: nesting=1,keyctl=1` en `/etc/pve/lxc/<ID>.conf`.

### Problemas con AppArmor (sockets Unix)

En algunos hosts (visto en Proxmox VE con Debian 13, kernel 6.17 y AppArmor 4.1), el perfil `docker-default` impide crear sockets Unix dentro de los contenedores. Los síntomas son:

- Postgres: `could not create Unix socket ... Permission denied`
- Python: `PermissionError` en `socket.socketpair()`
- `npm ci`: `spawn sh EACCES` durante el build

Para confirmarlo en el host: `sudo dmesg | grep 'apparmor="DENIED"'`. Las líneas mostrarán `profile="docker-default"`.

Como solución, el archivo `docker-compose.apparmor.yml` desactiva AppArmor solo para los contenedores de esta app:

```bash
docker compose -f docker-compose.yml -f docker-compose.apparmor.yml up -d --build
```

En Portainer se agrega como *Additional paths* del stack, si tu versión lo ofrece. El override no aplica al *build* del frontend: si `npm ci` falla, construye esa imagen en otra máquina.

## Uso diario

1. **Materia prima → Registrar compra** (icono de carrito) para cargar el stock real. Define un *stock mínimo* para recibir alertas en el Resumen.
2. **Productos**: sube la foto y revisa la receta. Las figuras de concreto usan `peso agua × 2` gramos de *Concreto estándar*; las velas usan su peso en *Cera de soya*. Puedes agregar mechas, pegante, etc. como materiales sueltos.
3. **Lotes → Nuevo lote**: agrega uno o varios productos con sus unidades (puedes cambiar la cera de cada uno). Revisa o ajusta los materiales y crea el lote.
4. En el lote, **Iniciar** descuenta los materiales. Si falta stock, la app avisa y puedes continuar de todas formas. **Terminar** pide las unidades producidas y defectuosas de cada producto.
5. Las ventas o ajustes de producto terminado se registran desde la ficha del producto.

## Desarrollo local (sin Docker)

```bash
# Backend (Python 3.12+)
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL=sqlite:///./dev.db UPLOAD_DIR=./uploads ADMIN_PASSWORD=admin JWT_SECRET=dev
alembic upgrade head && python -m app.bootstrap
uvicorn app.main:app --reload            # http://localhost:8000/api/docs

# Frontend (Node 20+), en otra terminal
cd frontend
npm install
npm run dev                              # http://localhost:5173 (proxy /api → :8000)
```

### Pruebas

```bash
cd backend && pytest                     # o: docker compose exec backend pytest
```

Las pruebas verifican, entre otras cosas, que los costos coincidan con la hoja (ej. *Manos* ≈ $1.134, *Luna Velas* = $4.800), el ciclo de vida de los lotes (descuento, producción y reversión), el ordenamiento y la importación CSV.

### Cambios al modelo de datos

```bash
cd backend
# edita app/models.py y luego:
alembic revision --autogenerate -m "descripción"
alembic upgrade head
```

### Regenerar los datos iniciales desde la hoja de cálculo

```bash
unzip -p Informacion.ods content.xml > /tmp/content.xml
python backend/scripts/ods_to_seed.py /tmp/content.xml backend/app/seed/initial_data.json
```

## Respaldos

```bash
# Base de datos
docker compose exec db pg_dump -U luci luci > respaldo_$(date +%F).sql
# Restaurar
docker compose exec -T db psql -U luci luci < respaldo.sql
# Fotos
docker run --rm -v luci-notturne_uploads:/data -v "$PWD":/out alpine tar czf /out/fotos.tgz -C /data .
```

## Variables de entorno (`.env`)

| Variable            | Descripción                                          | Por defecto |
|---------------------|------------------------------------------------------|-------------|
| `APP_PORT`          | Puerto publicado de la app                           | `8085`      |
| `POSTGRES_*`        | Usuario, contraseña y nombre de la base              | `luci`      |
| `JWT_SECRET`        | Secreto para firmar sesiones (**obligatorio**)       |             |
| `ADMIN_USERNAME`    | Usuario administrador inicial                        | `admin`     |
| `ADMIN_PASSWORD`    | Contraseña inicial (**obligatoria**)                 |             |
| `CURRENCY`          | Moneda para mostrar precios (ISO 4217)               | `COP`       |
| `SEED_INITIAL_DATA` | Cargar datos de `Informacion.ods` si la BD está vacía | `true`      |
| `MAX_UPLOAD_MB`     | Tamaño máximo de foto                                | `10`        |
| `INSTALL_DEV`       | Incluir pytest en la imagen del backend              | `true`      |

## Supuestos tomados de `Informacion.ods`

- En la hoja de velas, la columna **Valor** se interpretó como el **precio del molde**, igual que *Precio Molde* en concreto.
- El costo de las velas usa por defecto **cera de soya**. Al crear un lote o en la ficha del producto puedes ver y usar parafina o palma.
- Las mechas no estaban incluidas en el costo de la hoja, así que no se agregaron a las recetas. Agrégalas en cada producto si quieres costearlas.
- "Rollo Mecha" se cargó como 60 unidades por $8.200; ajusta la unidad si son metros.
- El agua del concreto no se costea, y el peso real del concreto es 2 × peso agua.
