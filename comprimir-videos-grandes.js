#!/usr/bin/env node
/**
 * comprimir-videos-grandes.js
 * ----------------------------
 * Busca en fotos/full/ los vídeos que superan el límite de GitHub (100 MB)
 * y los comprime (reduce resolución y calidad) hasta bajarlos de ese límite,
 * sustituyendo el archivo original por la versión comprimida.
 *
 * USO (desde la carpeta que contiene "fotos\"):
 *   node comprimir-videos-grandes.js
 *
 * Requiere las mismas dependencias que organizar-fotos.js, más ffprobe-static:
 *   npm install ffmpeg-static ffprobe-static fluent-ffmpeg
 */

const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const LIMITE_MB = 95;  // margen de seguridad bajo el límite real de 100MB de GitHub
const OBJETIVO_MB = 88; // tamaño al que intentamos apuntar (algo por debajo del límite de seguridad)
const AUDIO_KBPS = 96;  // bitrate de audio fijo
const BITRATE_MIN_KBPS = 300; // no bajar de aquí aunque el vídeo sea muy largo (para no destrozar la calidad)
const CARPETA_FULL = path.join(process.cwd(), 'fotos', 'full');
const VID_EXT = ['.mp4', '.mov', '.3gp', '.avi', '.mkv', '.webm'];

function tamanioMB(ruta) {
  return fs.statSync(ruta).size / (1024 * 1024);
}

function obtenerDuracionSegundos(ruta) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(ruta, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

function comprimir(rutaOriginal, rutaTemporal, videoKbps) {
  return new Promise((resolve, reject) => {
    ffmpeg(rutaOriginal)
      .videoCodec('libx264')
      .size('?x720')
      .videoBitrate(`${videoKbps}k`)
      .audioCodec('aac')
      .audioBitrate(`${AUDIO_KBPS}k`)
      .outputOptions(['-preset fast'])
      .on('end', resolve)
      .on('error', reject)
      .save(rutaTemporal);
  });
}

async function main() {
  if (!fs.existsSync(CARPETA_FULL)) {
    console.error(`No encuentro la carpeta ${CARPETA_FULL}. Ejecuta esto desde la carpeta que contiene "fotos\\".`);
    process.exit(1);
  }

  const archivos = fs.readdirSync(CARPETA_FULL)
    .filter(f => VID_EXT.includes(path.extname(f).toLowerCase()));

  const grandes = archivos.filter(f => tamanioMB(path.join(CARPETA_FULL, f)) > LIMITE_MB);

  if (grandes.length === 0) {
    console.log('No hay vídeos que superen el límite. No hace falta comprimir nada.');
    return;
  }

  console.log(`Encontrados ${grandes.length} vídeos por encima de ${LIMITE_MB}MB. Comprimiendo...\n`);

  for (const file of grandes) {
    const original = path.join(CARPETA_FULL, file);
    const temporal = path.join(CARPETA_FULL, 'tmp_' + file);
    const antes = tamanioMB(original).toFixed(1);

    try {
      const duracion = await obtenerDuracionSegundos(original); // en segundos
      // bits totales objetivo = tamaño objetivo en bits, repartidos entre vídeo y audio
      const bitsTotales = OBJETIVO_MB * 8 * 1024 * 1024;
      const bitsAudio = AUDIO_KBPS * 1000 * duracion;
      let videoKbps = Math.floor((bitsTotales - bitsAudio) / duracion / 1000);
      videoKbps = Math.max(videoKbps, BITRATE_MIN_KBPS);

      const duracionMin = (duracion / 60).toFixed(1);
      process.stdout.write(`  ${file} (${antes} MB, ${duracionMin} min) → bitrate ${videoKbps}k → comprimiendo... `);

      await comprimir(original, temporal, videoKbps);
      const despues = tamanioMB(temporal).toFixed(1);
      fs.unlinkSync(original);
      fs.renameSync(temporal, original);

      if (tamanioMB(original) > 100) {
        console.log(`⚠️  sigue pesando ${despues} MB. Es un vídeo muy largo; puede necesitar dividirse en dos o más partes.`);
      } else {
        console.log(`${despues} MB ✅`);
      }
    } catch (e) {
      console.log(`❌ error con "${file}": ${e.message}`);
      if (fs.existsSync(temporal)) fs.unlinkSync(temporal);
    }
  }

  console.log('\nListo. Vuelve a intentar el commit en GitHub Desktop.');
}

main();
