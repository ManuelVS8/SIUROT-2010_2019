#!/usr/bin/env node
/**
 * organizar-fotos.js
 * -------------------
 * Prepara las fotos Y VÍDEOS de la promoción para la web de recuerdos.
 *
 * Qué hace:
 *  1. Lee la fecha real de cada archivo: EXIF (fotos), y si no hay,
 *     intenta sacarla del propio nombre de archivo (WhatsApp, cámaras...).
 *  2. Ordena todo cronológicamente y lo renombra 0001, 0002...
 *  3. Fotos: genera una copia optimizada (fotos/full) y una miniatura
 *     ligera (fotos/thumb).
 *  4. Vídeos: copia el vídeo original a fotos/full y genera un fotograma
 *     como miniatura/portada en fotos/thumb (usando ffmpeg incluido).
 *  5. Crea fotos/manifest.json con todo el listado, que es lo que lee
 *     memoria.html para mostrar la galería agrupada por año/día.
 *
 * USO:
 *   1) npm install exifr sharp ffmpeg-static fluent-ffmpeg
 *   2) node organizar-fotos.js "/ruta/a/la/carpeta/con/las/fotos/y/videos"
 *
 * Resultado: se crea una carpeta "fotos/" en el sitio desde donde ejecutes
 * el script, con todo listo para copiar junto a memoria.html.
 */

const fs = require('fs');
const path = require('path');
const exifr = require('exifr');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

const SRC = process.argv[2];
if (!SRC) {
  console.error('Uso: node organizar-fotos.js "<carpeta_origen>"');
  process.exit(1);
}
if (!fs.existsSync(SRC)) {
  console.error(`No existe la carpeta: ${SRC}`);
  process.exit(1);
}

const OUT = path.join(process.cwd(), 'fotos');
const OUT_FULL = path.join(OUT, 'full');
const OUT_THUMB = path.join(OUT, 'thumb');
[OUT, OUT_FULL, OUT_THUMB].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
const VID_EXT = ['.mp4', '.mov', '.3gp', '.avi', '.mkv', '.webm'];
const VALID_EXT = [...IMG_EXT, ...VID_EXT];

async function leerFecha(fullPath, filename) {
  // 1) Intentar EXIF real (solo aplica a fotos; en vídeos normalmente no hay)
  try {
    const exif = await exifr.parse(fullPath, ['DateTimeOriginal', 'CreateDate']);
    const fecha = exif?.DateTimeOriginal || exif?.CreateDate;
    if (fecha) return new Date(fecha);
  } catch (e) {
    // sin EXIF legible, probamos el nombre de archivo
  }

  // 2) Fotos/vídeos de WhatsApp (y similares) llevan la fecha en el propio
  //    nombre, aunque WhatsApp borre el EXIF: IMG-20150612-WA0001.jpg,
  //    VID-20150612-WA0003.mp4, o el formato típico IMG_20150612_123456.jpg
  const match = filename.match(/(\d{4})(\d{2})(\d{2})/);
  if (match) {
    const [, y, m, d] = match;
    const anio = parseInt(y, 10);
    const mes = parseInt(m, 10);
    const dia = parseInt(d, 10);
    const anioActual = new Date().getFullYear();
    const plausible = anio >= 1995 && anio <= anioActual && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31;
    if (plausible) return new Date(anio, mes - 1, dia);
  }

  // 3) Nada fiable: no usamos la fecha de modificación del archivo,
  //    porque al descargar de Mega esa fecha pasa a ser "hoy"
  return null;
}

function generarPosterVideo(videoSrc, outDir, outName) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoSrc)
      .on('end', resolve)
      .on('error', (err) => reject(err))
      .screenshots({
        timestamps: ['1'],
        filename: outName,
        folder: outDir,
        size: '480x?',
      });
  });
}

async function main() {
  const files = fs
    .readdirSync(SRC)
    .filter((f) => VALID_EXT.includes(path.extname(f).toLowerCase()));

  if (files.length === 0) {
    console.error('No se han encontrado fotos ni vídeos en esa carpeta.');
    process.exit(1);
  }

  console.log(`Encontrados ${files.length} archivos. Leyendo fechas...`);

  const items = [];
  for (const file of files) {
    const full = path.join(SRC, file);
    const ext = path.extname(file).toLowerCase();
    const tipo = VID_EXT.includes(ext) ? 'video' : 'foto';
    const date = await leerFecha(full, file);
    items.push({ file, date, tipo });
  }

  items.sort((a, b) => {
    if (a.date && b.date) return a.date - b.date;
    if (a.date && !b.date) return -1; // las que sí tienen fecha van primero
    if (!a.date && b.date) return 1;
    return 0; // ambas sin fecha: se quedan en el orden en que se leyeron
  });

  console.log('Generando copias optimizadas, miniaturas y portadas de vídeo (puede tardar varios minutos)...');
  const manifest = [];
  let i = 1;
  let errores = 0;
  let sinFecha = 0;
  let numVideos = 0;

  for (const item of items) {
    const num = String(i).padStart(4, '0');
    const src = path.join(SRC, item.file);
    const extOriginal = path.extname(item.file).toLowerCase();

    try {
      let fileOut, thumbOut;

      if (item.tipo === 'video') {
        fileOut = num + extOriginal;
        thumbOut = num + '.jpg';
        fs.copyFileSync(src, path.join(OUT_FULL, fileOut));
        await generarPosterVideo(src, OUT_THUMB, thumbOut);
        numVideos++;
      } else {
        fileOut = num + '.jpg';
        thumbOut = num + '.jpg';
        await sharp(src).rotate().jpeg({ quality: 88 }).toFile(path.join(OUT_FULL, fileOut));
        await sharp(src)
          .rotate()
          .resize({ width: 480, withoutEnlargement: true })
          .jpeg({ quality: 75 })
          .toFile(path.join(OUT_THUMB, thumbOut));
      }

      const dia = item.date ? item.date.toISOString().slice(0, 10) : 'sin-fecha';
      if (dia === 'sin-fecha') sinFecha++;
      manifest.push({ id: i, tipo: item.tipo, file: fileOut, thumb: thumbOut, dia, original: item.file });
      i++;
    } catch (e) {
      console.warn(`⚠️  No se pudo procesar "${item.file}": ${e.message}`);
      errores++;
    }
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const dias = [...new Set(manifest.map((m) => m.dia).filter((d) => d !== 'sin-fecha'))];
  console.log('\n✅ Listo.');
  console.log(`   ${manifest.length} archivos procesados correctamente (${numVideos} vídeos, ${manifest.length - numVideos} fotos).`);
  if (errores) console.log(`   ${errores} archivos no se pudieron procesar (revisa los avisos arriba).`);
  if (sinFecha) console.log(`   ${sinFecha} archivos sin fecha reconocible → agrupados como "Sin fecha".`);
  console.log(`   ${dias.length} días distintos detectados: ${dias.join(', ')}`);
  console.log(`\nAhora copia memoria.html en esta misma carpeta, junto a "fotos/", y ya puedes subirlo a GitHub Pages.`);
}

main();
