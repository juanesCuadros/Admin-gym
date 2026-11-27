"""
Optimización de avatares / fotos de perfil de deportistas para almacenamiento liviano en PostgreSQL.

Convierte cualquier imagen de entrada (JPEG, PNG, WEBP) en un cuadrado centrado de máximo 320x320 px
codificado en formato WebP comprimido (~10-25 KB por deportista en vez de hasta 3 MB crudos),
corrigiendo orientación EXIF de cámaras móviles (iOS / Android) y protegiendo contra bombas de descompresión.
"""
import base64
import binascii
import io

from fastapi import HTTPException, status
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_RAW_UPLOAD_BYTES = 6 * 1024 * 1024  # 6 MB máximo antes de comprimir
AVATAR_MAX_SIDE_PX = 320
AVATAR_TARGET_MAX_BYTES = 64 * 1024     # Tope estricto post-compresión: 64 KB
Image.MAX_IMAGE_PIXELS = 25_000_000     # Protección anti-decompression-bomb


def optimizar_foto_deportista(texto_base64: str) -> tuple[bytes, str]:
    """
    Decodifica un string Base64 (con o sin prefijo data URL), valida que sea una imagen real,
    corrige orientación EXIF, recorta 1:1 centrado a máx 320x320 px y comprime a image/webp.
    Retorna `(webp_bytes, 'image/webp')`.
    """
    if not texto_base64 or not texto_base64.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"codigo": "FOTO_VACIA", "mensaje": "No se recibió contenido de imagen."},
        )

    limpio = texto_base64.strip()
    if limpio.startswith("data:"):
        limpio = limpio.split(",", 1)[-1]

    # Limpiar saltos de línea que algunos codificadores móviles insertan en base64
    limpio = "".join(limpio.split())

    try:
        raw_bytes = base64.b64decode(limpio, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"codigo": "FOTO_NO_VALIDA", "mensaje": "La imagen codificada no es válida."},
        )

    if len(raw_bytes) > MAX_RAW_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={
                "codigo": "FOTO_MUY_GRANDE",
                "mensaje": "La imagen original supera el límite permitido de 6 MB.",
            },
        )

    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            img = ImageOps.exif_transpose(img)

            # Si tiene transparencia, componer sobre fondo neutro oscuro antes de pasar a RGB
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                rgba = img.convert("RGBA")
                fondo = Image.new("RGBA", rgba.size, (21, 28, 44, 255))
                img_rgb = Image.alpha_composite(fondo, rgba).convert("RGB")
            else:
                img_rgb = img.convert("RGB")

            w, h = img_rgb.size
            if w < 16 or h < 16:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"codigo": "FOTO_MUY_PEQUENA", "mensaje": "La imagen es demasiado pequeña."},
                )

            # Recorte cuadrado centrado 1:1
            if w != h:
                lado = min(w, h)
                left = (w - lado) // 2
                top = (h - lado) // 2
                img_rgb = img_rgb.crop((left, top, left + lado, top + lado))

            # Redimensionar solo si supera AVATAR_MAX_SIDE_PX
            if img_rgb.width > AVATAR_MAX_SIDE_PX:
                img_rgb = img_rgb.resize(
                    (AVATAR_MAX_SIDE_PX, AVATAR_MAX_SIDE_PX),
                    Image.Resampling.LANCZOS,
                )

            for quality in (78, 65, 50):
                out = io.BytesIO()
                img_rgb.save(out, format="WEBP", quality=quality, method=6)
                webp_bytes = out.getvalue()
                if len(webp_bytes) <= AVATAR_TARGET_MAX_BYTES:
                    break
            else:
                # Si aún excediera 64 KB (caso extremo de ruido de alta frecuencia), reducir a 240x240
                img_small = img_rgb.resize((240, 240), Image.Resampling.LANCZOS)
                out = io.BytesIO()
                img_small.save(out, format="WEBP", quality=55, method=6)
                webp_bytes = out.getvalue()

            return webp_bytes, "image/webp"

    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "codigo": "FOTO_NO_VALIDA",
                "mensaje": "El archivo debe ser una imagen válida (JPG, PNG o WEBP).",
            },
        )
