from pathlib import Path
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import math
import rasterio
from rasterio.warp import transform

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
PUBLIC_DIR = BASE_DIR / "public"
DATA_DIR = BASE_DIR / "data"

BATHY_PATH = DATA_DIR / "Baltic_bathymetry_4326.tif"
TID_PATH = DATA_DIR / "gebco_2025_tid_Baltic_display_4326.tif"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten later if needed
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/public", StaticFiles(directory=PUBLIC_DIR), name="public")

bathy_ds = rasterio.open(BATHY_PATH)
tid_ds = rasterio.open(TID_PATH)

TID_MAP = {
    10: ("Predicted (satellite-derived)", "low"),
    11: ("Predicted (satellite-derived)", "low"),
    17: ("Interpolated", "medium"),
    41: ("Measured bathymetry", "high"),
}

def tid_label(code: int | None):
    if code is None:
        return {"label": "No data", "confidence": "none"}
    if code in TID_MAP:
        label, confidence = TID_MAP[code]
        return {"label": label, "confidence": confidence}
    if 40 <= code < 50:
        return {"label": "Measured bathymetry", "confidence": "high"}
    if 20 <= code < 40:
        return {"label": "Interpolated / mixed sources", "confidence": "medium"}
    if 10 <= code < 20:
        return {"label": "Predicted (satellite-derived)", "confidence": "low"}
    return {"label": f"Unknown (TID {code})", "confidence": "unknown"}

def sample_dataset(ds, lon, lat):
    if str(ds.crs) != "EPSG:4326":
        xs, ys = transform("EPSG:4326", ds.crs, [lon], [lat])
        x, y = xs[0], ys[0]
    else:
        x, y = lon, lat

    try:
        row, col = ds.index(x, y)
    except Exception:
        return None

    if row < 0 or col < 0 or row >= ds.height or col >= ds.width:
        return None

    val = ds.read(1, window=((row, row + 1), (col, col + 1)))[0, 0]

    if ds.nodata is not None and val == ds.nodata:
        return None

    return val.item() if hasattr(val, "item") else val

@app.get("/")
def root():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/api/query")
def query_point(lat: float = Query(...), lng: float = Query(...)):
    depth = sample_dataset(bathy_ds, lng, lat)
    tid = sample_dataset(tid_ds, lng, lat)
    tid_int = int(tid) if tid is not None else None
    meta = tid_label(tid_int)

    return {
        "lat": lat,
        "lng": lng,
        "depth_m": float(depth) if depth is not None else None,
        "tid_code": tid_int,
        "tid_label": meta["label"],
        "confidence": meta["confidence"],
    }

class ProfileRequest(BaseModel):
    coords: list[list[float]]  # [[lat, lng], [lat, lng], ...]

def interpolate_points(coords, samples_per_segment=60):
    points = []
    cumulative_km = []
    total = 0.0

    for i in range(len(coords) - 1):
        lat1, lon1 = coords[i]
        lat2, lon2 = coords[i + 1]

        for j in range(samples_per_segment):
            t = j / samples_per_segment
            lat = lat1 + (lat2 - lat1) * t
            lon = lon1 + (lon2 - lon1) * t

            if points:
                prev_lat, prev_lon = points[-1]
                dx = (lon - prev_lon) * 111.32 * max(0.3, abs(math.cos(math.radians(lat))))
                dy = (lat - prev_lat) * 110.57
                total += math.hypot(dx, dy)

            points.append((lat, lon))
            cumulative_km.append(round(total, 3))

    last = tuple(coords[-1])
    if points:
        prev_lat, prev_lon = points[-1]
        lat, lon = last
        dx = (lon - prev_lon) * 111.32 * max(0.3, abs(math.cos(math.radians(lat))))
        dy = (lat - prev_lat) * 110.57
        total += math.hypot(dx, dy)

    points.append(last)
    cumulative_km.append(round(total, 3))
    return points, cumulative_km

@app.post("/api/profile")
def profile(req: ProfileRequest):
    if len(req.coords) < 2:
        return {"error": "Need at least 2 points"}

    points, chain_km = interpolate_points(req.coords, samples_per_segment=60)

    depths = []
    tid_codes = []
    tid_labels = []

    for lat, lng in points:
        depth = sample_dataset(bathy_ds, lng, lat)
        tid = sample_dataset(tid_ds, lng, lat)

        tid_int = int(tid) if tid is not None else None
        meta = tid_label(tid_int)

        depths.append(float(depth) if depth is not None else None)
        tid_codes.append(tid_int)
        tid_labels.append(meta["label"])

    return {
        "dist_km": chain_km,
        "depth_m": depths,
        "tid_code": tid_codes,
        "tid_label": tid_labels,
        "points": [{"lat": lat, "lng": lng} for lat, lng in points],
    }
