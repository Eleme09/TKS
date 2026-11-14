package core

import (
	"image"
	"image/color"
	"testing"
)

func TestKeyMap(t *testing.T) {
	g := NewKeyGuard()
	cases := map[string]uint16{"KeyA": 0x41, "Digit5": 0x35, "F12": 0x7B, "Enter": 0x0D, "Numpad3": 0x63, "Space": 0x20}
	for code, vk := range cases {
		got, _, ok := g.Filter("down", code)
		if !ok || got != vk {
			t.Errorf("%s → %x %v", code, got, ok)
		}
	}
	if _, ext, ok := g.Filter("down", "ArrowUp"); !ok || !ext {
		t.Error("flecha debe ser extendida")
	}
	for _, bad := range []string{"MetaLeft", "MetaRight", "OSLeft", "Foo", "", "LaunchApp1"} {
		if _, _, ok := g.Filter("down", bad); ok {
			t.Errorf("%q debería bloquearse", bad)
		}
	}
	if _, _, ok := g.Filter("hold", "KeyA"); ok {
		t.Error("acción desconocida")
	}
}

func TestCtrlAltDelBlocked(t *testing.T) {
	g := NewKeyGuard()
	g.Filter("down", "ControlLeft")
	g.Filter("down", "AltRight")
	if _, _, ok := g.Filter("down", "Delete"); ok {
		t.Error("Ctrl+Alt+Supr debe bloquearse")
	}
	g.Filter("up", "AltRight")
	if _, _, ok := g.Filter("down", "Delete"); !ok {
		t.Error("Ctrl+Supr solo sí se permite")
	}
}

func TestUpWithoutDown(t *testing.T) {
	g := NewKeyGuard()
	if _, _, ok := g.Filter("up", "KeyA"); ok {
		t.Error("up sin down de tecla normal se ignora")
	}
	if _, _, ok := g.Filter("up", "ShiftLeft"); !ok {
		t.Error("up de modificador sí")
	}
	g.Filter("down", "KeyB")
	if len(g.PressedCodes()) != 1 {
		t.Error("PressedCodes")
	}
	g.Reset()
	if len(g.PressedCodes()) != 0 {
		t.Error("Reset")
	}
}

func TestScaledSize(t *testing.T) {
	if w, h := ScaledSize(1920, 1080, 1600); w != 1600 || h != 900 {
		t.Error(w, h)
	}
	if w, h := ScaledSize(1280, 720, 1600); w != 1280 || h != 720 {
		t.Error(w, h)
	}
	if w, _ := ScaledSize(0, 5, 1600); w != 0 {
		t.Error("cero")
	}
}

func TestFrameEncoderSkipsIdentical(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 2000, 1000))
	for y := 0; y < 1000; y++ {
		for x := 0; x < 2000; x++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 7, 255})
		}
	}
	e := NewFrameEncoder()
	data, w, h, send, err := e.Encode(img, 60)
	if err != nil || !send || w != 1600 || h != 800 || len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		t.Fatalf("primer frame: %v %v %d %d", err, send, w, h)
	}
	if _, _, _, send, _ := e.Encode(img, 60); send {
		t.Error("frame idéntico no debe enviarse")
	}
	e.ForceNext()
	if _, _, _, send, _ := e.Encode(img, 60); !send {
		t.Error("ForceNext debe reenviar")
	}
	img.Set(5, 5, color.RGBA{1, 2, 3, 255})
	if _, _, _, send, _ := e.Encode(img, 60); !send {
		t.Error("frame distinto debe enviarse")
	}
}
