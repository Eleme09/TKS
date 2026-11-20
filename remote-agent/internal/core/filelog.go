package core

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

// Registro a archivo + buffer en memoria.
//
// El agente de nube corre como icono de bandeja (sin consola, build con
// -H=windowsgui): fmt.Printf a stdout no se ve en ningún lado. Logf sigue
// escribiendo a stdout (gratis, no estorba cuando sí hay consola, p.ej. en
// pruebas o si alguien lo corre con `go run`), pero además:
//   - si EnableFileLog se llamó, se añade la misma línea a un archivo
//     (log.txt junto al .exe), truncándolo si crece demasiado;
//   - siempre se guarda en un buffer circular en memoria, que es lo que
//     muestra la ventanita de "Ver registro" de la bandeja.
const (
	fileLogMaxBytes = 2 * 1024 * 1024 // truncar por encima de esto
	ringMaxLines    = 300
)

var (
	logMu   sync.Mutex
	logFile *os.File
	ring    []string
)

// EnableFileLog abre (o trunca si ya pesa demasiado) el archivo de log.
func EnableFileLog(path string) error {
	logMu.Lock()
	defer logMu.Unlock()
	if logFile != nil {
		logFile.Close()
		logFile = nil
	}
	if fi, err := os.Stat(path); err == nil && fi.Size() > fileLogMaxBytes {
		os.Remove(path)
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	logFile = f
	return nil
}

func Logf(format string, args ...any) {
	line := fmt.Sprintf("%s  %s", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
	logMu.Lock()
	ring = append(ring, line)
	if len(ring) > ringMaxLines {
		ring = ring[len(ring)-ringMaxLines:]
	}
	if logFile != nil {
		fmt.Fprintln(logFile, line)
	}
	logMu.Unlock()
	fmt.Println(line) // sin efecto si no hay consola adjunta; gratis si la hay
}

// RecentLog devuelve las últimas líneas registradas, para mostrarlas (p.ej.
// en la ventanita de estado del icono de bandeja).
func RecentLog() string {
	logMu.Lock()
	defer logMu.Unlock()
	if len(ring) == 0 {
		return "(sin actividad registrada todavía)"
	}
	start := 0
	if len(ring) > 40 {
		start = len(ring) - 40
	}
	return strings.Join(ring[start:], "\n")
}
