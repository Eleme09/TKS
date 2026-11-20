package core

// Salida de consola.
//
// Ya NO hay franja/banner visual durante la sesión (quitado 2026-11-20 a
// pedido explícito del usuario): el aviso de que el control remoto existe es
// que el programa está visible — ventana o, en el agente de nube, icono de
// bandeja — no un mensaje adicional que interrumpa a quien está frente al
// equipo mientras la sesión corre. Lo que sigue intacto: el programa nunca se
// oculta de la lista de procesos, Ctrl+Shift+F12 sigue cortando la sesión
// desde este mismo equipo, y el relay sigue auditando quién se conectó y
// cuándo (eso es trazabilidad interna, no un aviso en pantalla).
//
// Logf (qué se registra) y RecentLog (buffer para la ventanita de la
// bandeja) viven en filelog.go, junto con EnableFileLog.

// BaseTitle es el título de la consola cuando el programa corre con consola
// visible (servidor/visor de red local). El agente de nube, como icono de
// bandeja, no usa esto.
var BaseTitle = "Placer — control remoto"

// vtOK: si la consola entiende ANSI. Ya sin uso real (el banner que lo
// necesitaba se quitó), se deja declarado para no romper InitConsole.
var vtOK bool
