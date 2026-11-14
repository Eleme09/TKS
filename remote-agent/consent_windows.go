//go:build windows

package main

import (
	"context"
	"fmt"
	"runtime"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	procMessageBoxW = user32.NewProc("MessageBoxW")
	procFindWindowW = user32.NewProc("FindWindowW")
	procPostMessage = user32.NewProc("PostMessageW")
)

const (
	mbYesNo       = 0x00000004
	mbIconWarning = 0x00000030
	mbDefButton2  = 0x00000100
	mbSetFore     = 0x00010000
	mbTopmost     = 0x00040000
	idYes         = 6
	idNo          = 7
	wmCommand     = 0x0111
	wmClose       = 0x0010

	consentTitle = "Placer — Solicitud de control remoto"
)

func closeConsentDialog() {
	t, _ := windows.UTF16PtrFromString(consentTitle)
	h, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(t)))
	if h != 0 {
		procPostMessage.Call(h, wmCommand, idNo, 0)
		procPostMessage.Call(h, wmClose, 0, 0)
	}
}

// askConsent muestra el diálogo nativo Sí/No. Rechaza solo a los 30 s, o si
// ctx termina (sesión cancelada). Devuelve true únicamente si se pulsó "Sí".
func askConsent(ctx context.Context, viewer string) bool {
	text := fmt.Sprintf("«%s» solicita VER y CONTROLAR este equipo (pantalla, mouse y teclado).\n\n"+
		"Pulsa Sí solo si tú lo esperabas. Si no, pulsa No.\n"+
		"Se rechaza automáticamente en %d segundos.\n\n"+
		"Podrás cortar la sesión cuando quieras con Ctrl+Shift+F12 o cerrando la ventana negra del agente.",
		viewer, consentTimeout)
	tp, _ := windows.UTF16PtrFromString(text)
	cp, _ := windows.UTF16PtrFromString(consentTitle)
	res := make(chan uintptr, 1)
	go func() {
		runtime.LockOSThread()
		r, _, _ := procMessageBoxW.Call(0, uintptr(unsafe.Pointer(tp)), uintptr(unsafe.Pointer(cp)),
			mbYesNo|mbIconWarning|mbDefButton2|mbSetFore|mbTopmost)
		res <- r
	}()
	timer := time.NewTimer(consentTimeout * time.Second)
	defer timer.Stop()
	select {
	case r := <-res:
		return r == idYes
	case <-timer.C:
	case <-ctx.Done():
	}
	closeConsentDialog()
	select {
	case <-res:
	case <-time.After(2 * time.Second):
	}
	return false
}
