#!/usr/bin/env node
/**
 * subir-por-tandas.js
 * --------------------
 * Soluciona el error "pack exceeds maximum allowed size (2.00 GiB)" de GitHub.
 *
 * Qué hace:
 *  1. Deshace los commits grandes que ya tenías (sin perder ni un archivo,
 *     todo se queda tal cual en tu carpeta).
 *  2. Vuelve a organizarlo todo en commits mucho más pequeños (por defecto,
 *     de hasta 1,5 GB cada uno, con margen de sobra bajo el límite de 2GB).
 *  3. Sube cada tanda por separado, una detrás de otra, automáticamente.
 *
 * IMPORTANTE:
 *  - Ejecútalo DESDE la carpeta del repositorio (donde está index.html, fotos\ y .git).
 *  - Necesita que "git" funcione ya en la terminal (lo tienes instalado) y que el
 *    remoto ya esté conectado por SSH (lo configuramos en los pasos anteriores).
 *  - Puede tardar bastante rato en total (sube cada tanda una a una). No cierres
 *    la ventana ni apagues el ordenador mientras corre. Mantén Avast desactivado.
 *
 * USO:
 *   node subir-por-tandas.js
 */

const { execSync } = require('child_process');
const fs = require('fs');

const LIMITE_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5GB por tanda (margen bajo el límite real de 2GB)
const COMMIT_INICIAL = '2027cbd'; // el "Initial commit" ligero, punto de partida limpio
const ARCHIVO_TEMPORAL = '_tanda_actual.txt';

function run(cmd, silent = false) {
  console.log('\n> ' + cmd);
  return execSync(cmd, {
    stdio: silent ? 'pipe' : 'inherit',
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 100,
  });
}

function main() {
  console.log('Volviendo a un punto de partida limpio (no se pierde ningún archivo)...');
  run(`git reset --soft ${COMMIT_INICIAL}`);
  run('git reset'); // deja todo como cambios pendientes, sin perder nada

  console.log('\nCalculando la lista de archivos pendientes...');
  const salida = run('git status --porcelain -uall', true);
  const lineas = salida.split('\n').filter(Boolean);

  let archivos = lineas
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
    .filter((p) => p && p !== ARCHIVO_TEMPORAL)
    .filter((p) => fs.existsSync(p) && fs.statSync(p).isFile())
    .map((p) => ({ path: p, size: fs.statSync(p).size }));

  console.log(`Archivos pendientes de subir: ${archivos.length}`);

  let tanda = [];
  let tandaBytes = 0;
  let numTanda = 1;

  function commitYSubirTanda() {
    if (tanda.length === 0) return;
    fs.writeFileSync(ARCHIVO_TEMPORAL, tanda.map((f) => f.path).join('\n'), 'utf8');

    run(`git add --pathspec-from-file=${ARCHIVO_TEMPORAL}`);
    run(`git commit -m "Tanda ${numTanda}"`);

    const mb = (tandaBytes / 1024 / 1024).toFixed(0);
    console.log(`\n=== Subiendo tanda ${numTanda} (${mb} MB, ${tanda.length} archivos) ===`);
    run('git push origin main');
    console.log(`✅ Tanda ${numTanda} subida correctamente.\n`);

    numTanda++;
    tanda = [];
    tandaBytes = 0;
  }

  for (const archivo of archivos) {
    if (tandaBytes + archivo.size > LIMITE_BYTES && tanda.length > 0) {
      commitYSubirTanda();
    }
    tanda.push(archivo);
    tandaBytes += archivo.size;
  }
  commitYSubirTanda(); // última tanda que quede

  if (fs.existsSync(ARCHIVO_TEMPORAL)) fs.unlinkSync(ARCHIVO_TEMPORAL);

  console.log('\n🎉 Todo subido, en tandas, sin superar el límite de GitHub.');
}

main();
