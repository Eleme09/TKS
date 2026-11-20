//go:build windows

package core

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var procGetConsoleWindow = kernel32.NewProc("GetConsoleWindow")

// HasConsole dice si el proceso tiene una consola adjunta (false en un build
// -H=windowsgui sin consola, como el icono de bandeja del agente de nube).
func HasConsole() bool {
	h, _, _ := procGetConsoleWindow.Call()
	return h != 0
}

// FatalBox muestra un error con un cuadro de diálogo nativo (sirve cuando no
// hay consola donde imprimir, p.ej. el agente de nube en modo bandeja).
func FatalBox(title, text string) {
	tp, _ := windows.UTF16PtrFromString(text)
	cp, _ := windows.UTF16PtrFromString(title)
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(tp)), uintptr(unsafe.Pointer(cp)), 0x10) // MB_ICONERROR
}
