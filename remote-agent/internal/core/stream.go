package core

import (
	"bytes"
	"image"
	"sync"
	"time"

	"golang.org/x/image/draw"

	"placer/remote-agent/internal/proto"
)

// tileStreamer: envío por regiones con control de flujo por confirmación.
//
// Reglas anti-lag:
//   - Nunca hay más de maxInflight paquetes sin confirmar. Si el visor va
//     atrasado, este ciclo NO envía nada: la referencia ("prev") no avanza, así
//     que el siguiente envío lleva el estado MÁS RECIENTE (se saltan los viejos).
//     No existe cola que crezca.
//   - fps, calidad y escala se adaptan al RTT medido con los ack, dentro de los
//     límites que fija el selector Baja/Media/Alta del visor.
//   - Con movimiento se baja la calidad; al quedar quieta la pantalla se reenvía
//     a calidad plena.
const (
	maxInflight   = 2
	fullEvery     = 3 * time.Second
	fullFraction  = 0.5
	ackStall      = 3 * time.Second
	settleAfter   = 400 * time.Millisecond
	statEvery     = 2 * time.Second
	minFPS        = 5.0
	motionQuality = 35
)

var scaleSteps = []float64{1, 0.75, 0.5}

type tileStreamer struct {
	mu sync.Mutex

	maxW   int
	fpsCap float64

	prev, scaled *image.RGBA
	w, h         int
	changed      []bool
	jb           bytes.Buffer

	seq      uint32
	acked    uint32
	sentAt   map[uint32]time.Time
	needFull bool
	ackOn    bool

	fps        float64
	scaleStep  int
	slow, fast int
	rtt        float64

	lastMouse  time.Time
	lastChange time.Time
	lastFull   time.Time
	lowQSent   bool

	lastStat   time.Time
	statBytes  int
	statFrames int
}

func newTileStreamer(maxW int, fpsCap int) *tileStreamer {
	if maxW <= 0 {
		maxW = MaxFrameWidth
	}
	if fpsCap <= 0 {
		fpsCap = 20
	}
	if fpsCap > 30 {
		fpsCap = 30
	}
	return &tileStreamer{maxW: maxW, fpsCap: float64(fpsCap), sentAt: map[uint32]time.Time{},
		needFull: true, fps: float64(fpsCap) / 2, lastChange: time.Now(), lastStat: time.Now()}
}

// qualityCaps traduce la calidad JPEG elegida (40/60/85) a límites de fps.
func (t *tileStreamer) cap(quality int) float64 {
	c := t.fpsCap
	switch {
	case quality <= 40 && c > 12:
		c = 12
	case quality <= 60 && c > 20:
		c = 20
	}
	return c
}

func (t *tileStreamer) interval(quality int) time.Duration {
	t.mu.Lock()
	defer t.mu.Unlock()
	f := t.fps
	if !t.ackOn {
		f = t.cap(quality)
	}
	if c := t.cap(quality); f > c {
		f = c
	}
	if f < minFPS {
		f = minFPS
	}
	return time.Duration(float64(time.Second) / f)
}

func (t *tileStreamer) noteMotion() {
	t.mu.Lock()
	t.lastMouse = time.Now()
	t.mu.Unlock()
}

func (t *tileStreamer) forceFull() {
	t.mu.Lock()
	t.needFull = true
	t.mu.Unlock()
}

// onAck: confirmación acumulada del visor (seq = último paquete dibujado).
func (t *tileStreamer) onAck(seq uint32, resync bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.ackOn = true
	if int32(seq-t.acked) > 0 && int32(t.seq-seq) >= 0 {
		if st, ok := t.sentAt[seq]; ok {
			sample := float64(time.Since(st).Milliseconds())
			if t.rtt == 0 {
				t.rtt = sample
			} else {
				t.rtt = t.rtt*0.8 + sample*0.2
			}
			switch {
			case t.rtt < 100:
				t.fps += 1
				t.fast++
				t.slow = 0
			case t.rtt > 250:
				t.fps *= 0.8
				t.slow++
				t.fast = 0
			default:
				t.fast, t.slow = 0, 0
			}
			if t.fps < minFPS {
				t.fps = minFPS
			}
			if t.fps > t.fpsCap {
				t.fps = t.fpsCap
			}
			if t.slow >= 5 && t.scaleStep < len(scaleSteps)-1 {
				t.scaleStep++
				t.slow = 0
				t.needFull = true
			}
			if t.fast >= 80 && t.scaleStep > 0 {
				t.scaleStep--
				t.fast = 0
				t.needFull = true
			}
		}
		for s := range t.sentAt {
			if int32(seq-s) >= 0 {
				delete(t.sentAt, s)
			}
		}
		t.acked = seq
	}
	if resync {
		t.needFull = true
	}
}

func (t *tileStreamer) inflightLocked() int { return int(int32(t.seq - t.acked)) }

// step procesa una captura. Devuelve el paquete a enviar (o nil) y el nuevo
// tamaño si cambió (para avisar al visor con "info").
func (t *tileStreamer) step(src *image.RGBA, quality int) (pkt []byte, newW, newH int, err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	sb := src.Bounds()
	w, h := ScaledSize(sb.Dx(), sb.Dy(), int(float64(t.maxW)*scaleSteps[t.scaleStep]))
	if w == 0 {
		return nil, 0, 0, nil
	}
	if t.ackOn && t.inflightLocked() >= maxInflight {
		if oldest, ok := t.sentAt[t.acked+1]; ok && now.Sub(oldest) > ackStall {
			t.acked = t.seq // el visor dejó de confirmar: no quedarse mudo
			t.sentAt = map[uint32]time.Time{}
			t.needFull = true
		}
		return nil, 0, 0, nil // visor atrasado: saltar, mandar luego lo más reciente
	}
	if t.prev == nil || t.w != w || t.h != h {
		t.prev = image.NewRGBA(image.Rect(0, 0, w, h))
		t.scaled = nil
		t.w, t.h = w, h
		t.changed = make([]bool, ((w+TileSize-1)/TileSize)*((h+TileSize-1)/TileSize))
		t.needFull = true
		newW, newH = w, h
	}
	cur := src
	if w != sb.Dx() || h != sb.Dy() {
		if t.scaled == nil {
			t.scaled = image.NewRGBA(image.Rect(0, 0, w, h))
		}
		draw.ApproxBiLinear.Scale(t.scaled, t.scaled.Bounds(), src, sb, draw.Src, nil)
		cur = t.scaled
	}
	cols, rows, n := diffTiles(t.prev, cur, t.changed)
	total := cols * rows
	if n > 0 {
		t.lastChange = now
	}
	motion := now.Sub(t.lastMouse) < 300*time.Millisecond || float64(n) > 0.05*float64(total)
	q := quality
	if motion && q > motionQuality {
		q = motionQuality
	}
	if t.rtt > 250 && q > 25 {
		q -= 15
	}
	full := t.needFull || float64(n) > fullFraction*float64(total) || now.Sub(t.lastFull) > fullEvery
	settled := n == 0 && t.lowQSent && now.Sub(t.lastChange) > settleAfter
	if n == 0 && !full && !settled {
		return nil, newW, newH, nil
	}
	if settled {
		full, q = true, quality // pantalla quieta: refresco a calidad plena
	}
	seq := t.seq + 1
	if full {
		pkt, err = encodeFullPacket(cur, seq, q, &t.jb)
		if err == nil {
			copyRect(t.prev, cur, cur.Bounds())
			t.lastFull = now
			t.needFull = false
		}
	} else {
		pkt, err = encodeDeltaPacket(cur, runsFromTiles(t.changed, cols, rows, w, h), seq, q, &t.jb)
		if err == nil {
			for _, r := range runsFromTiles(t.changed, cols, rows, w, h) {
				copyRect(t.prev, cur, r)
			}
		}
	}
	if err != nil {
		return nil, newW, newH, err
	}
	t.lowQSent = q < quality
	t.seq = seq
	t.sentAt[seq] = now
	t.statBytes += len(pkt)
	t.statFrames++
	return pkt, newW, newH, nil
}

// statMsg devuelve el mensaje de estadísticas si toca (cada 2 s).
func (t *tileStreamer) statMsg() []byte {
	t.mu.Lock()
	defer t.mu.Unlock()
	d := time.Since(t.lastStat)
	if d < statEvery {
		return nil
	}
	secs := d.Seconds()
	m := proto.StatMsg(int(t.rtt), int(float64(t.statFrames)/secs+0.5), int(float64(t.statBytes)/1024/secs),
		[]string{"completa", "media", "reducida"}[t.scaleStep])
	t.lastStat, t.statBytes, t.statFrames = time.Now(), 0, 0
	return m
}
