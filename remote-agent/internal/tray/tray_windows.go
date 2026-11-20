//go:build windows

package tray

import (
	"context"
	"runtime"
	"sync"
	"sync/atomic"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Icono de bandeja implementado directo sobre Win32 (Shell_NotifyIconW +
// una ventana oculta que recibe sus mensajes), sin ninguna librería de
// terceros — ver el comentario de paquete en tray.go para por qué.

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	shell32  = windows.NewLazySystemDLL("shell32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procRegisterClassExW = user32.NewProc("RegisterClassExW")
	procCreateWindowExW  = user32.NewProc("CreateWindowExW")
	procDefWindowProcW   = user32.NewProc("DefWindowProcW")
	procDestroyWindow    = user32.NewProc("DestroyWindow")
	procShowWindow       = user32.NewProc("ShowWindow")
	procGetMessageW      = user32.NewProc("GetMessageW")
	procTranslateMessage = user32.NewProc("TranslateMessage")
	procDispatchMessageW = user32.NewProc("DispatchMessageW")
	procPostMessageW     = user32.NewProc("PostMessageW")
	procPostQuitMessage  = user32.NewProc("PostQuitMessage")
	procLoadIconW        = user32.NewProc("LoadIconW")
	procSetForegroundWin = user32.NewProc("SetForegroundWindow")
	procCreatePopupMenu  = user32.NewProc("CreatePopupMenu")
	procAppendMenuW      = user32.NewProc("AppendMenuW")
	procDestroyMenu      = user32.NewProc("DestroyMenu")
	procTrackPopupMenuEx = user32.NewProc("TrackPopupMenuEx")
	procGetCursorPos     = user32.NewProc("GetCursorPos")
	procMessageBoxW      = user32.NewProc("MessageBoxW")
	procShellNotifyIconW = shell32.NewProc("Shell_NotifyIconW")
	procGetModuleHandleW = kernel32.NewProc("GetModuleHandleW")
)

const (
	wmDestroy       = 0x0002
	wmClose         = 0x0010
	wmCommand       = 0x0111
	wmRButtonUp     = 0x0205
	wmLButtonDblClk = 0x0203
	wmTrayCallback  = 0x8001 // WM_APP + 1

	nimAdd    = 0
	nimModify = 1
	nimDelete = 2

	nifMessage = 0x00000001
	nifIcon    = 0x00000002
	nifTip     = 0x00000004

	idiApplication = 32512

	tpmRightButton = 0x0002
	tpmReturnCmd   = 0x0100

	mfString    = 0x00000000
	mfGrayed    = 0x00000001
	mfDisabled  = 0x00000002
	mfSeparator = 0x00000800

	swHide = 0
	swShow = 5

	menuIDStatus       = 1001
	menuIDCloseSession = 1002
	menuIDShowLog      = 1003
	menuIDQuit         = 1004

	classNameStr = "PlacerAgenteNubeTrayWnd"
)

type point struct{ x, y int32 }

// NOTIFYICONDATAW completa (versión actual del SDK): cbSize = sizeof(este
// struct) le dice a Shell_NotifyIcon qué versión usamos. El alineado de Go
// para estos tipos coincide con el de C en amd64 (sin bitfields de por
// medio), que es el mismo supuesto que ya usa el resto de este repo en
// input_windows.go/capture_windows.go.
type notifyIconDataW struct {
	cbSize           uint32
	_                uint32 // relleno: alinea hWnd (8) a múltiplo de 8
	hWnd             windows.Handle
	uID              uint32
	uFlags           uint32
	uCallbackMessage uint32
	hIcon            windows.Handle
	szTip            [128]uint16
	dwState          uint32
	dwStateMask      uint32
	szInfo           [256]uint16
	uVersion         uint32
	szInfoTitle      [64]uint16
	dwInfoFlags      uint32
	guidItem         windows.GUID
	hBalloonIcon     windows.Handle
}

type wndClassExW struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     windows.Handle
	hIcon         windows.Handle
	hCursor       windows.Handle
	hbrBackground windows.Handle
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       windows.Handle
}

type msg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
}

func u16(s string) *uint16 {
	p, _ := windows.UTF16PtrFromString(s)
	return p
}

var (
	activeTray atomic.Pointer[trayState]
)

// trayState: lo que el WndProc necesita leer; vive aparte de Tray (API
// pública) para que el callback de Win32 (función libre, sin receptor) pueda
// llegar a él sin pasar por cgo ni closures con captura insegura.
type trayState struct {
	hwnd       windows.Handle
	mu         sync.Mutex
	status     string
	sessActive bool
	tray       *Tray
}

// Start crea el icono de bandeja y arranca su ciclo de mensajes en una
// goroutine aparte (no bloquea). Devuelve error si Win32 lo rechaza.
func (t *Tray) Start(ctx context.Context) error {
	errCh := make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		hwnd, err := createHiddenWindow()
		if err != nil {
			errCh <- err
			return
		}
		st := &trayState{hwnd: hwnd, status: "Conectando…", tray: t}
		activeTray.Store(st)
		if err := addIcon(hwnd, "Placer — agente de control remoto\nConectando…"); err != nil {
			errCh <- err
			return
		}
		errCh <- nil

		go func() { // hilo aparte: solo observa ctx, no toca la ventana directo
			<-ctx.Done()
			procPostMessageW.Call(uintptr(hwnd), wmCommand, uintptr(menuIDQuit), 0)
		}()

		runMessageLoop(hwnd)
		removeIcon(hwnd)
	}()
	return <-errCh
}

// SetState actualiza el tooltip del icono y qué opciones del menú se ven
// habilitadas (se usa cada vez que el usuario abre el menú con clic derecho,
// no hace falta reconstruirlo antes).
func (t *Tray) SetState(status string, sessionActive bool) {
	st := activeTray.Load()
	if st == nil {
		return
	}
	st.mu.Lock()
	st.status = status
	st.sessActive = sessionActive
	st.mu.Unlock()
	tip := "Placer — agente de control remoto\n" + status
	setTip(st.hwnd, tip)
}

func createHiddenWindow() (windows.Handle, error) {
	hInst, _, _ := procGetModuleHandleW.Call(0)
	wndProcPtr := windows.NewCallback(wndProc)
	cls := wndClassExW{
		style:         0,
		lpfnWndProc:   wndProcPtr,
		hInstance:     windows.Handle(hInst),
		lpszClassName: u16(classNameStr),
	}
	cls.cbSize = uint32(unsafe.Sizeof(cls))
	r, _, _ := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&cls)))
	if r == 0 {
		return 0, winErr("RegisterClassExW")
	}
	hwnd, _, _ := procCreateWindowExW.Call(
		0, uintptr(unsafe.Pointer(u16(classNameStr))), uintptr(unsafe.Pointer(u16("Placer agente (bandeja)"))),
		0, 0, 0, 0, 0, 0, 0, hInst, 0)
	if hwnd == 0 {
		return 0, winErr("CreateWindowExW")
	}
	// Nunca se muestra (ShowWindow no se llama con SW_SHOW): existe solo
	// para recibir los mensajes de Shell_NotifyIcon y del menú.
	return windows.Handle(hwnd), nil
}

func winErr(where string) error { return &winError{where} }

type winError struct{ where string }

func (e *winError) Error() string { return e.where + ": falló" }

func addIcon(hwnd windows.Handle, tip string) error {
	nid := newNID(hwnd, tip)
	nid.uFlags |= nifIcon | nifMessage
	icon, _, _ := procLoadIconW.Call(0, uintptr(idiApplication))
	nid.hIcon = windows.Handle(icon)
	r, _, _ := procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&nid)))
	if r == 0 {
		return winErr("Shell_NotifyIconW(add)")
	}
	return nil
}

func setTip(hwnd windows.Handle, tip string) {
	nid := newNID(hwnd, tip)
	procShellNotifyIconW.Call(nimModify, uintptr(unsafe.Pointer(&nid)))
}

func removeIcon(hwnd windows.Handle) {
	nid := newNID(hwnd, "")
	procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&nid)))
}

func newNID(hwnd windows.Handle, tip string) notifyIconDataW {
	var nid notifyIconDataW
	nid.cbSize = uint32(unsafe.Sizeof(nid))
	nid.hWnd = hwnd
	nid.uID = 1
	nid.uCallbackMessage = wmTrayCallback
	nid.uFlags = nifTip
	t := windows.StringToUTF16(tip)
	n := len(t)
	if n > len(nid.szTip) {
		n = len(nid.szTip)
	}
	copy(nid.szTip[:], t[:n])
	nid.szTip[len(nid.szTip)-1] = 0
	return nid
}

func runMessageLoop(hwnd windows.Handle) {
	var m msg
	for {
		r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			return // WM_QUIT (PostQuitMessage, solo desde "Salir")
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

// wndProc: función libre (sin receptor, exigencia de syscall.NewCallback).
// Lee el estado activo por hwnd a través de activeTray — solo hay un icono
// en todo el proceso, así que no hace falta un mapa.
func wndProc(hwnd windows.Handle, message uint32, wParam, lParam uintptr) uintptr {
	st := activeTray.Load()
	switch message {
	case wmTrayCallback:
		switch uint32(lParam) {
		case wmRButtonUp:
			showMenu(hwnd, st)
		case wmLButtonDblClk:
			showLogWindow(st)
		}
		return 0
	case wmCommand:
		handleCommand(hwnd, st, uint32(wParam&0xFFFF))
		return 0
	case wmClose:
		// La X de cualquier ventana (incluida esta, si alguna vez se
		// mostrara) NUNCA mata el proceso: solo se oculta. La única forma
		// de terminar de verdad es "Salir" del menú (handleCommand→Quit).
		procShowWindow.Call(uintptr(hwnd), swHide)
		return 0
	case wmDestroy:
		procPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(uintptr(hwnd), uintptr(message), wParam, lParam)
	return r
}

func handleCommand(hwnd windows.Handle, st *trayState, id uint32) {
	if st == nil {
		return
	}
	switch id {
	case menuIDCloseSession:
		if st.tray.OnCloseSession != nil {
			go st.tray.OnCloseSession()
		}
	case menuIDShowLog:
		showLogWindow(st)
	case menuIDQuit:
		if st.tray.OnQuit != nil {
			st.tray.OnQuit() // normalmente termina el proceso (os.Exit) desde main
		}
		procDestroyWindow.Call(uintptr(hwnd))
	}
}

func showMenu(hwnd windows.Handle, st *trayState) {
	if st == nil {
		return
	}
	st.mu.Lock()
	status, active := st.status, st.sessActive
	st.mu.Unlock()

	hmenu, _, _ := procCreatePopupMenu.Call()
	if hmenu == 0 {
		return
	}
	defer procDestroyMenu.Call(hmenu)
	procAppendMenuW.Call(hmenu, mfString|mfGrayed|mfDisabled, uintptr(menuIDStatus), uintptr(unsafe.Pointer(u16(status))))
	procAppendMenuW.Call(hmenu, mfSeparator, 0, 0)
	closeFlags := uintptr(mfString)
	if !active {
		closeFlags = mfString | mfGrayed | mfDisabled
	}
	procAppendMenuW.Call(hmenu, closeFlags, uintptr(menuIDCloseSession), uintptr(unsafe.Pointer(u16("Cerrar sesión actual"))))
	procAppendMenuW.Call(hmenu, mfString, uintptr(menuIDShowLog), uintptr(unsafe.Pointer(u16("Ver registro"))))
	procAppendMenuW.Call(hmenu, mfSeparator, 0, 0)
	procAppendMenuW.Call(hmenu, mfString, uintptr(menuIDQuit), uintptr(unsafe.Pointer(u16("Salir"))))

	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForegroundWin.Call(uintptr(hwnd))
	procTrackPopupMenuEx.Call(hmenu, tpmRightButton, uintptr(pt.x), uintptr(pt.y), uintptr(hwnd), 0)
	procPostMessageW.Call(uintptr(hwnd), 0, 0, 0) // WM_NULL: cierra bien el menú (patrón estándar de Shell_NotifyIcon)
}

// showLogWindow: "ventanita" del registro — deliberadamente simple
// (MessageBoxW con el buffer de Logf). Su botón X solo cierra este cuadro,
// nunca el proceso (MessageBoxW es modal y no tiene relación con la
// ventana/mensaje principal del tray).
func showLogWindow(st *trayState) {
	if st == nil {
		return
	}
	go func() { // MessageBoxW bloquea: aparte, para no congelar el loop de mensajes
		text := "Últimas líneas del registro:\n\n" + recentLogFn()
		tp, _ := windows.UTF16PtrFromString(text)
		cp, _ := windows.UTF16PtrFromString("Placer — agente de control remoto")
		procMessageBoxW.Call(0, uintptr(unsafe.Pointer(tp)), uintptr(unsafe.Pointer(cp)), 0x40000) // MB_SETFOREGROUND
	}()
}

// recentLogFn: inyectado por main.go (core.RecentLog) para no crear un
// import circular ni una dependencia dura de internal/tray hacia internal/core.
var recentLogFn = func() string { return "" }

// SetLogSource conecta la fuente del registro que muestra "Ver registro".
func SetLogSource(f func() string) { recentLogFn = f }
