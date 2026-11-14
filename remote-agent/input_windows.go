//go:build windows

package main

import (
	"math"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32          = windows.NewLazySystemDLL("user32.dll")
	procSendInput   = user32.NewProc("SendInput")
	procGetMetrics  = user32.NewProc("GetSystemMetrics")
	procMapVirtKeyW = user32.NewProc("MapVirtualKeyW")
)

const (
	inputMouse    = 0
	inputKeyboard = 1

	mevMove       = 0x0001
	mevLeftDown   = 0x0002
	mevLeftUp     = 0x0004
	mevRightDown  = 0x0008
	mevRightUp    = 0x0010
	mevMiddleDown = 0x0020
	mevMiddleUp   = 0x0040
	mevWheel      = 0x0800
	mevVirtDesk   = 0x4000
	mevAbsolute   = 0x8000

	kevExtended = 0x0001
	kevKeyUp    = 0x0002
)

type mouseInput struct {
	dx, dy    int32
	mouseData uint32
	flags     uint32
	time      uint32
	extra     uintptr
}

type keybdInput struct {
	vk, scan uint16
	flags    uint32
	time     uint32
	extra    uintptr
}

// input replica la estructura INPUT de Win32 (la unión ocupa lo que MOUSEINPUT,
// la más grande; Go alinea los campos igual que C en amd64 y x86).
type input struct {
	typ uint32
	mi  mouseInput
}

func sendInput(in *input) {
	procSendInput.Call(1, uintptr(unsafe.Pointer(in)), unsafe.Sizeof(*in))
}

func metric(i int) int32 {
	r, _, _ := procGetMetrics.Call(uintptr(i))
	return int32(r)
}

var buttonsDown = map[int]bool{}

func btnFlags(b int) (down, up uint32, ok bool) {
	switch b {
	case 0:
		return mevLeftDown, mevLeftUp, true
	case 1:
		return mevMiddleDown, mevMiddleUp, true
	case 2:
		return mevRightDown, mevRightUp, true
	}
	return 0, 0, false
}

func clamp01(v float64) float64 {
	if math.IsNaN(v) || v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// absPos convierte (0..1 de la pantalla principal) a coordenadas absolutas 0..65535 del escritorio virtual.
func absPos(x, y float64) (int32, int32) {
	b, err := primaryBounds()
	if err != nil {
		return 0, 0
	}
	px := float64(b.Min.X) + clamp01(x)*float64(b.Dx()-1)
	py := float64(b.Min.Y) + clamp01(y)*float64(b.Dy()-1)
	vx, vy := float64(metric(76)), float64(metric(77)) // SM_X/YVIRTUALSCREEN
	vw, vh := float64(metric(78)), float64(metric(79)) // SM_CX/CYVIRTUALSCREEN
	if vw < 2 || vh < 2 {
		return 0, 0
	}
	return int32((px - vx) * 65535 / (vw - 1)), int32((py - vy) * 65535 / (vh - 1))
}

func injectMouse(a string, x, y float64, b int, d float64) {
	var in input
	in.typ = inputMouse
	switch a {
	case "move":
		in.mi.dx, in.mi.dy = absPos(x, y)
		in.mi.flags = mevMove | mevAbsolute | mevVirtDesk
	case "down", "up":
		down, up, ok := btnFlags(b)
		if !ok {
			return
		}
		in.mi.dx, in.mi.dy = absPos(x, y)
		in.mi.flags = mevMove | mevAbsolute | mevVirtDesk
		if a == "down" {
			in.mi.flags |= down
			buttonsDown[b] = true
		} else {
			in.mi.flags |= up
			delete(buttonsDown, b)
		}
	case "wheel":
		// El visor manda d=+1 (arriba) / -1 (abajo): igual que WHEEL_DELTA positivo = arriba.
		n := d
		if math.Abs(n) <= 10 {
			n *= 120
		}
		if n > 1200 {
			n = 1200
		}
		if n < -1200 {
			n = -1200
		}
		in.mi.mouseData = uint32(int32(n))
		in.mi.flags = mevWheel
	default:
		return
	}
	sendInput(&in)
}

func releaseMouseButtons() {
	for b := range buttonsDown {
		if _, up, ok := btnFlags(b); ok {
			var in input
			in.typ = inputMouse
			in.mi.flags = up
			sendInput(&in)
		}
	}
	buttonsDown = map[int]bool{}
}

func injectKey(vk uint16, ext bool, down bool) {
	var in input
	in.typ = inputKeyboard
	ki := (*keybdInput)(unsafe.Pointer(&in.mi))
	ki.vk = vk
	sc, _, _ := procMapVirtKeyW.Call(uintptr(vk), 0)
	ki.scan = uint16(sc)
	if ext {
		ki.flags |= kevExtended
	}
	if !down {
		ki.flags |= kevKeyUp
	}
	sendInput(&in)
}
