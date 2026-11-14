//go:build windows

package core

import (
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	kernel32        = windows.NewLazySystemDLL("kernel32.dll")
	procSetTitleW   = kernel32.NewProc("SetConsoleTitleW")
	procSetOutputCP = kernel32.NewProc("SetConsoleOutputCP")
	procRegHotKey   = user32.NewProc("RegisterHotKey")
	procGetMessageW = user32.NewProc("GetMessageW")
)

func InitConsole() {
	procSetOutputCP.Call(65001)
	h, err := windows.GetStdHandle(windows.STD_OUTPUT_HANDLE)
	if err != nil {
		return
	}
	var mode uint32
	if windows.GetConsoleMode(h, &mode) == nil {
		if windows.SetConsoleMode(h, mode|windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING) == nil {
			vtOK = true
		}
	}
}

func SetConsoleTitle(s string) {
	p, err := windows.UTF16PtrFromString(s)
	if err == nil {
		procSetTitleW.Call(uintptr(unsafe.Pointer(p)))
	}
}

type winMsg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	ptX     int32
	ptY     int32
}

// InstallLocalCut registra Ctrl+Shift+F12 como tecla de corte local.
func InstallLocalCut(onCut func()) {
	go func() {
		runtime.LockOSThread()
		const modCtrl, modShift, modNoRepeat, vkF12 = 0x2, 0x4, 0x4000, 0x7B
		r, _, _ := procRegHotKey.Call(0, 1, modCtrl|modShift|modNoRepeat, vkF12)
		if r == 0 {
			Logf("AVISO: no se pudo registrar Ctrl+Shift+F12 (otro programa la usa). Cierra la ventana para cortar.")
			return
		}
		var m winMsg
		for {
			r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if int32(r) <= 0 {
				return
			}
			if m.message == 0x0312 { // WM_HOTKEY
				go onCut()
			}
		}
	}()
}

// InstallCloseHandler corta la sesión al cerrar la ventana, Ctrl+C, cierre de sesión o apagado.
func InstallCloseHandler(onClose func()) {
	cb := windows.NewCallback(func(ctrlType uint32) uintptr {
		onClose()
		return 0 // dejar que Windows continúe con el cierre normal
	})
	kernel32.NewProc("SetConsoleCtrlHandler").Call(cb, 1)
}
