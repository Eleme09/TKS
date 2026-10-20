# Guía de aprendizaje: cómo se crea una app web

Documento para pasarle a otra sesión de Claude. Contexto: el usuario es
principiante, está aprendiendo programación web y quiere entender cómo se
construye una app de verdad, no solo copiar código.

## Instrucciones para la sesión que lo reciba

- Enseña en español, informal moderado, directo y sin adornos.
- No inventes datos. Si no estás seguro de algo, dilo.
- Prioriza que entienda el porqué, no solo el qué. Explica solo lo que le sume.
- Que haga cosas pequeñas y reales desde temprano. Nada de tutoriales eternos.
- Cuando él escriba código, revísalo y corrígelo. No se lo reescribas todo.

## Orden para aprender

1. **HTML**: la estructura (títulos, botones, tablas, formularios). Unos días.
2. **CSS**: la apariencia (colores, espacios, layout con flexbox y grid,
   diseño responsive para celular). 2-3 semanas para defenderse.
3. **JavaScript**: el comportamiento (eventos, datos, validaciones, llamadas
   al servidor). Es lo más largo y donde vive la lógica.
4. **Backend con Node.js**: un servidor que guarda datos, valida usuarios y
   habla con otras APIs. Sigue siendo JavaScript.
5. **Base de datos y SQL básico**: tablas, consultas, relaciones.
6. **Deploy**: subir el proyecto a un servidor para que sea público.

Regla: no saltar a frameworks (React, etc.) antes de dominar JavaScript puro.

## Cómo se arma una app web (proceso)

1. **Definir qué hace**: quién la usa, qué datos maneja, qué reglas de negocio
   tiene. Escribirlo antes de programar.
2. **Modelar los datos**: qué tablas necesita y cómo se relacionan.
3. **Backend**: rutas (endpoints) que reciben peticiones, validan, leen y
   escriben en la base de datos, y responden en JSON.
4. **Autenticación y permisos**: login, roles, qué puede ver cada quien. La
   validación va SIEMPRE en el servidor; esconder cosas en el navegador no es
   seguridad.
5. **Frontend**: HTML + CSS + JS que pide datos al backend y los pinta.
6. **Probar de verdad**: correr la app, usarla, intentar romperla. No dar nada
   por bueno sin haberlo ejecutado.
7. **Deploy**: subir a un hosting, configurar variables de entorno (claves
   secretas), revisar que el despliegue realmente quedó vivo.
8. **Mantener**: logs, errores, backups, cuotas del hosting y la base de datos.

## Ejemplo real: el proyecto TKS (este repo)

Es una herramienta interna que rastrea ingresos de modelos y calcula nómina
quincenal. Sirve para ver cómo encajan las piezas.

| Pieza | Qué es | Dónde está |
|---|---|---|
| Frontend | HTML + CSS + JS en un solo archivo | `public/index.html`, `public/asistencia.html` |
| Backend | Servidor Node.js con las rutas `/api/...` | `server.js` |
| Lógica pura | Funciones de dinero y fechas, con tests | `chaturbate-lib.js`, `chaturbate-lib.test.js` |
| Base de datos | Postgres en Supabase, tablas con prefijo `cb_` | `schema.sql` documenta el estado base |
| Hosting | Render, despliega solo al hacer push a `master` | |
| Secretos | Variables de entorno, nunca en el código | `env.bat` local, panel de Render |

Lecturas recomendadas para aprender de este código, en orden:
1. `public/index.html`: ver cómo se conectan HTML, CSS y JS.
2. `chaturbate-lib.js`: funciones simples y testeables.
3. `server.js`: cómo se arma un servidor con rutas, sesiones y permisos.
4. `CLAUDE.md`: reglas de negocio y errores reales que ya ocurrieron.

## Lecciones reales de este proyecto (vale la pena entenderlas)

- **Zonas horarias**: el servidor corre en UTC y el negocio es en Colombia. Un
  cálculo de fechas con la hora del servidor cambió la quincena horas antes de
  tiempo. Siempre definir en qué zona se calcula cada cosa.
- **Límites ocultos**: la base de datos devolvía máximo 1000 filas por consulta
  sin avisar, y los totales salían cortos. Si un número empeora con el tiempo,
  sospechar de límites antes que de la lógica.
- **Consumo de recursos**: consultar la base cada 4 segundos desde cada
  navegador agotó la cuota gratis. Cachear y espaciar las consultas.
- **Un deploy fallido no avisa**: la versión vieja sigue sirviendo y nadie nota
  que el código nuevo no subió. Verificar el estado del deploy después de cada
  push.
- **Variables de entorno invisibles**: una configuración en el panel del
  hosting rompió el arranque aunque el repo estuviera bien.
- **Probar contra datos reales con cuidado**: usar cuentas de prueba propias,
  nunca cuentas reales.

## Primeros ejercicios sugeridos

1. Página HTML + CSS con un formulario de contacto, responsive en celular.
2. Calculadora o lista de tareas en JavaScript puro (sin librerías).
3. Servidor Node con una ruta `/api/tareas` que guarde en una base de datos.
4. Login simple con contraseña hasheada y una página que solo vea quien entró.
5. Desplegar ese proyecto en Render o similar.
