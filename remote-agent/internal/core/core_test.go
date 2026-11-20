package core

import (
	"bytes"
	"encoding/binary"
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

func TestFullGuardAllowsWinAndCombos(t *testing.T) {
	g := NewKeyGuardFull()
	for _, code := range []string{"MetaLeft", "MetaRight", "OSLeft", "PrintScreen", "F5", "ContextMenu", "Tab"} {
		if _, _, ok := g.Filter("down", code); !ok {
			t.Errorf("%s debe permitirse en control total", code)
		}
	}
	if vk, ext, _ := g.Filter("down", "MetaLeft"); vk != 0x5B || !ext {
		t.Error("MetaLeft debe ser VK_LWIN extendida")
	}
	if _, _, ok := g.Filter("up", "MetaLeft"); !ok {
		t.Error("up de Win")
	}
	// Ctrl+Alt+Supr sigue bloqueado y lo desconocido también.
	g.Filter("down", "ControlLeft")
	g.Filter("down", "AltLeft")
	if _, _, ok := g.Filter("down", "Delete"); ok {
		t.Error("Ctrl+Alt+Supr no se inyecta")
	}
	if _, _, ok := g.Filter("down", "LaunchApp1"); ok {
		t.Error("tecla desconocida")
	}
	// El modo restringido sigue sin Win.
	if _, _, ok := NewKeyGuard().Filter("down", "MetaLeft"); ok {
		t.Error("modo restringido bloquea Win")
	}
}

func TestDiffAndPacketRoundtrip(t *testing.T) {
	cur := image.NewRGBA(image.Rect(0, 0, 200, 130))
	prev := image.NewRGBA(image.Rect(0, 0, 200, 130))
	ch := make([]bool, 4*3)
	if _, _, n := diffTiles(prev, cur, ch); n != 0 {
		t.Fatalf("idénticas: %d", n)
	}
	cur.Set(70, 70, color.RGBA{255, 0, 0, 255}) // tile (1,1)
	cols, rows, n := diffTiles(prev, cur, ch)
	if n != 1 || !ch[1*cols+1] || cols != 4 || rows != 3 {
		t.Fatalf("un tile: n=%d", n)
	}
	rs := runsFromTiles(ch, cols, rows, 200, 130)
	if len(rs) != 1 || rs[0] != image.Rect(64, 64, 128, 128) {
		t.Fatalf("runs: %v", rs)
	}
	cur.Set(199, 129, color.RGBA{0, 255, 0, 255}) // tile de borde (3,2): 8x2
	cols, rows, _ = diffTiles(prev, cur, ch)
	rs = runsFromTiles(ch, cols, rows, 200, 130)
	if len(rs) != 2 || rs[1] != image.Rect(192, 128, 200, 130) {
		t.Fatalf("borde: %v", rs)
	}
	var jb bytes.Buffer
	pkt, err := encodeDeltaPacket(cur, rs, 7, 60, &jb)
	if err != nil || pkt[0] != PktDelta || binary.BigEndian.Uint32(pkt[1:5]) != 7 ||
		binary.BigEndian.Uint16(pkt[5:7]) != 200 || binary.BigEndian.Uint16(pkt[9:11]) != 2 {
		t.Fatalf("cabecera delta: %v %v", pkt[:11], err)
	}
	off := 11
	for i := 0; i < 2; i++ {
		l := int(binary.BigEndian.Uint32(pkt[off+8 : off+12]))
		if pkt[off+12] != 0xFF || pkt[off+13] != 0xD8 {
			t.Fatal("la región debe ser JPEG")
		}
		off += 12 + l
	}
	if off != len(pkt) {
		t.Fatal("longitud inconsistente")
	}
	full, err := encodeFullPacket(cur, 8, 60, &jb)
	if err != nil || full[0] != PktFull || full[9] != 0xFF {
		t.Fatal("paquete completo")
	}
}

func TestStreamerFlowControlSkipsInsteadOfQueueing(t *testing.T) {
	ts := newTileStreamer(1600, 20)
	ts.onAck(0, false) // el visor declara ack
	img := image.NewRGBA(image.Rect(0, 0, 640, 360))
	p1, _, _, err := ts.step(img, 60)
	if err != nil || p1 == nil || p1[0] != PktFull {
		t.Fatalf("primer paquete debe ser completo: %v", err)
	}
	img.Set(10, 10, color.RGBA{9, 9, 9, 255})
	p2, _, _, _ := ts.step(img, 60)
	if p2 == nil || p2[0] != PktDelta {
		t.Fatal("segundo: solo regiones")
	}
	img.Set(300, 300, color.RGBA{9, 9, 9, 255})
	if p3, _, _, _ := ts.step(img, 60); p3 != nil {
		t.Fatal("con 2 en vuelo no se envía (se salta)")
	}
	ts.onAck(1, false)
	p4, _, _, _ := ts.step(img, 60)
	if p4 == nil || p4[0] != PktDelta || binary.BigEndian.Uint16(p4[9:11]) == 0 {
		t.Fatal("tras el ack se manda lo más reciente (incluye lo saltado)")
	}
	ts.onAck(3, true) // resync pedido por el visor
	if p, _, _, _ := ts.step(img, 60); p == nil || p[0] != PktFull {
		t.Fatal("resync → paquete completo")
	}
}
