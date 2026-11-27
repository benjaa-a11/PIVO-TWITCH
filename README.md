# PIVO-TWITCH

Resolver de streams **públicos y en vivo** de Twitch a playlists HLS (`.m3u8`), preparado para Cloudflare Workers. Incluye una interfaz web responsive y una API para integraciones.

## Características

- Acepta enlaces `twitch.tv`, `www.twitch.tv`, `m.twitch.tv` y nombres de canal.
- Convierte el enlace recibido al nombre del canal y valida el dominio antes de realizar solicitudes.
- Obtiene el Playback Access Token mediante GraphQL y solicita la playlist a `usher.ttvnw.net`.
- Devuelve la URL M3U8 principal y las variantes de calidad publicadas por Twitch.
- Incluye una ruta de redirección estable que vuelve a resolver el canal en cada solicitud.
- No usa dependencias de ejecución: el backend utiliza las APIs nativas de Workers.
- No almacena tokens ni playlists; las respuestas de resolución usan `Cache-Control: no-store`.

## Ejemplo de uso

```text
https://TU-WORKER.workers.dev?id=https%3A%2F%2Fm.twitch.tv%2Fluzu_tv
```

También se admite un enlace sin codificar en el navegador:

```text
https://TU-WORKER.workers.dev?id=https://m.twitch.tv/luzu_tv
```

## API

### Redirección directa desde la raíz (ideal para reproductores)

La URL base acepta `id` y responde con un HTTP `302` hacia la playlist master M3U8 firmada y vigente de Twitch:

```text
https://TU-WORKER.workers.dev/?id=https://m.twitch.tv/luzu_tv.m3u8
```

El destino final es una URL de Twitch cuyo path termina en `.m3u8`. Se acepta el sufijo `.m3u8` en el enlace del canal y se elimina al validar el nombre del canal. La playlist master contiene las variantes de calidad que Twitch ofrece; el reproductor HLS compatible selecciona y adapta la calidad según las condiciones de reproducción.

### JSON con URL y variantes

```http
GET /api/resolve?id=https%3A%2F%2Fm.twitch.tv%2Fluzu_tv
```

La respuesta incluye `success`, `provider`, `channel`, `masterPlaylistUrl`, `variantCount`, `variants` y el texto `masterPlaylist`.

### Playlist M3U8 en texto plano

```http
GET /api/resolve?format=m3u8&id=https%3A%2F%2Fm.twitch.tv%2Fluzu_tv
```

### Redirección a una URL firmada reciente

```http
GET /live/luzu_tv.m3u8
```

La ruta vuelve a pedir el token de reproducción y responde con `302` hacia la playlist firmada actual.

### POST JSON

```http
POST /api/resolve
Content-Type: application/json

{"url":"https://m.twitch.tv/luzu_tv"}
```

### Health check

```http
GET /api/health
```

## Despliegue en Cloudflare Workers

1. Conectá este repositorio con GitHub en Cloudflare Workers & Pages.
2. Usá la raíz del repositorio como directorio del proyecto.
3. Cloudflare detectará `wrangler.jsonc`, `src/index.js` y los assets de `public/`.
4. Para CLI, necesitás Node.js y una cuenta de Cloudflare:

```bash
npm install
npx wrangler login
npm run dev
npm run deploy
```

No hacen falta secretos ni variables obligatorias para la configuración inicial.

### Protección de uso público

Como el resolver queda expuesto en Internet, se recomienda crear en Cloudflare una regla de Rate Limiting para `/api/resolve` y `/live/*` (por ejemplo, un límite inicial de 30 solicitudes por minuto y por IP, ajustable al uso real). El Worker no almacena tokens ni playlists.

### Variable opcional de CORS

`ALLOWED_ORIGINS` permite restringir las llamadas de navegador a una lista separada por comas. Sin esta variable se devuelve `Access-Control-Allow-Origin: *`, pensado para una API pública.

## Consideraciones técnicas

- La autenticación GraphQL de reproducción usa una operación persistida de Twitch. Es una interfaz interna de Twitch, no una API pública de Helix; Twitch puede cambiarla o imponer controles adicionales.
- Las URL `usher.ttvnw.net` incluyen credenciales firmadas y pueden caducar. No deben persistirse como direcciones permanentes.
- Esta primera versión resuelve canales en vivo; no procesa VODs, clips ni contenido privado.
- No elimina restricciones geográficas, autenticación, controles de acceso ni anuncios, y no proxyfica ni retransmite los segmentos del stream.
- El uso debe respetar los Términos de Twitch y los derechos de los titulares del contenido.

## Estructura

```text
PIVO-TWITCH/
├── public/
│   ├── app.js
│   ├── favicon.svg
│   ├── index.html
│   └── styles.css
├── src/
│   └── index.js
├── tests/
│   └── resolver.test.js
├── .dev.vars.example
├── .gitignore
├── package.json
├── README.md
└── wrangler.jsonc
```

## Licencia

MIT. Consultá `LICENSE`.
