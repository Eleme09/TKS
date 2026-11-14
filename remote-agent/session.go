package main

import (
	"context"
	"sync"
	"time"
)

// Una sesión = un visor pidiendo control. Nada se captura ni se ejecuta
// hasta que quien está frente al equipo pulsa "Sí" en el diálogo.

const captureInterval = 150 * time.Millisecond // ~6-7 fps

type session struct {
	cancel    context.CancelFunc
	done      chan struct{}
	viewer    string
	mu        sync.Mutex
	consented bool
	quality   int
	guard     *KeyGuard
}

func (s *session) isActive() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.consented
}

func (s *session) setConsented(v bool) {
	s.mu.Lock()
	s.consented = v
	s.mu.Unlock()
}

func (s *session) getQuality() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.quality
}

// handleInput ejecuta un mensaje mouse/key/quality del visor. Solo si hubo
// consentimiento local (segunda barrera además de la del relay).
func (s *session) handleInput(m inMsg) {
	if !s.isActive() {
		return
	}
	switch m.T {
	case "quality":
		if q, ok := QualityFromMsg(m.Q); ok {
			s.mu.Lock()
			s.quality = q
			s.mu.Unlock()
		}
	case "mouse":
		switch m.A {
		case "move", "down", "up", "wheel":
			s.mu.Lock()
			injectMouse(m.A, m.X, m.Y, m.B, m.D)
			s.mu.Unlock()
		}
	case "key":
		s.mu.Lock()
		vk, ext, ok := s.guard.Filter(m.A, m.Code)
		if ok {
			injectKey(vk, ext, m.A == "down")
		}
		s.mu.Unlock()
	}
}

// releaseAll suelta teclas y botones que hubieran quedado pulsados.
func (s *session) releaseAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.guard.PressedCodes() {
		if ki, ok := keyTable[c]; ok {
			injectKey(ki.vk, ki.extended, false)
		}
	}
	s.guard.Reset()
	releaseMouseButtons()
}

// captureLoop envía frames JPEG hasta que ctx termine.
func (s *session) captureLoop(ctx context.Context, send func([]byte) error, sendInfo func(w, h int)) {
	enc := NewFrameEncoder()
	t := time.NewTicker(captureInterval)
	defer t.Stop()
	lastSent := time.Time{}
	lw, lh := 0, 0
	var lastErrLog time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		img, err := captureScreen()
		if err != nil {
			if time.Since(lastErrLog) > 10*time.Second {
				logf("Error capturando pantalla: %v", err)
				lastErrLog = time.Now()
			}
			continue
		}
		if time.Since(lastSent) > 3*time.Second {
			enc.ForceNext() // refresco periódico por si el visor perdió un frame
		}
		data, w, h, doSend, err := enc.Encode(img, s.getQuality())
		if err != nil {
			logf("Error codificando frame: %v", err)
			continue
		}
		if w != lw || h != lh {
			lw, lh = w, h
			sendInfo(w, h)
		}
		if !doSend {
			continue
		}
		if err := send(data); err != nil {
			return
		}
		lastSent = time.Now()
	}
}
