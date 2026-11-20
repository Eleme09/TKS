package core

import (
	"context"
	"image"
	"os"
	"runtime"
	"sync"
	"time"

	"placer/remote-agent/internal/proto"
)

// Una sesión = un visor pidiendo control. Nada se captura ni se ejecuta
// hasta que quien está frente al equipo pulsa "Sí" en el diálogo.

// DefaultCaptureInterval ≈ 6-7 fps.
const DefaultCaptureInterval = 150 * time.Millisecond

// CaptureOptions fija los límites de envío de frames.
type CaptureOptions struct {
	Interval       time.Duration // 0 → DefaultCaptureInterval (mínimo 50 ms)
	MaxBytesPerSec int           // 0 → sin tope
	MaxWidth       int           // ancho máximo enviado; 0 → MaxFrameWidth
	MaxFPS         int           // tope de fps en modo regiones; 0 → 20 (máx. 30)
}

func (o CaptureOptions) maxW() int {
	if o.MaxWidth > 0 {
		return o.MaxWidth
	}
	return MaxFrameWidth
}

// Transport es por donde la sesión habla con el visor.
type Transport struct {
	WriteText   func([]byte) error
	WriteBinary func([]byte) error
}

// Session es una sesión de control remoto.
type Session struct {
	cancel    context.CancelFunc
	done      chan struct{}
	viewer    string
	viewOnly  bool
	mu        sync.Mutex
	consented bool
	quality   int
	guard     *KeyGuard
	ts        *tileStreamer // nil si este controlador no usa regiones
	tilesOn   bool          // el visor declaró soportar regiones
}

func (s *Session) isActive() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.consented
}

func (s *Session) setConsented(v bool) {
	s.mu.Lock()
	s.consented = v
	s.mu.Unlock()
}

func (s *Session) getQuality() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.quality
}

// handleInput ejecuta un mensaje mouse/key/quality del visor. Solo si hubo
// consentimiento local; en modo solo-ver el mouse y el teclado se ignoran.
func (s *Session) handleInput(m proto.InMsg) {
	if !s.isActive() {
		return
	}
	switch m.T {
	case "ack": // control de flujo: no exige modo con control
		if s.ts != nil && m.Seq >= 0 && m.Seq <= 4294967295 {
			s.ts.onAck(uint32(m.Seq), m.Resync)
		}
	case "caps":
		if s.ts != nil {
			s.mu.Lock()
			s.tilesOn = m.Tiles
			s.mu.Unlock()
			s.ts.forceFull()
		}
	case "text":
		if s.viewOnly {
			return
		}
		if t := proto.CleanText(m.Text); t != "" {
			s.mu.Lock()
			injectText(t)
			s.mu.Unlock()
		}
	case "quality":
		if q, ok := proto.QualityFromMsg(m.Q); ok {
			s.mu.Lock()
			s.quality = q
			s.mu.Unlock()
		}
	case "mouse":
		if s.viewOnly {
			return
		}
		switch m.A {
		case "move", "down", "up", "wheel":
			if s.ts != nil {
				s.ts.noteMotion()
			}
			s.mu.Lock()
			injectMouse(m.A, m.X, m.Y, m.B, m.D)
			s.mu.Unlock()
		}
	case "key":
		if s.viewOnly {
			return
		}
		s.mu.Lock()
		vk, ext, ok := s.guard.Filter(m.A, m.Code)
		if ok {
			injectKey(vk, ext, m.A == "down")
		}
		s.mu.Unlock()
	}
}

// releaseAll suelta teclas y botones que hubieran quedado pulsados.
func (s *Session) releaseAll() {
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

// byteBudget limita los bytes enviados por segundo.
type byteBudget struct {
	max   int
	start time.Time
	used  int
	nowFn func() time.Time
}

func (b *byteBudget) allow(n int) bool {
	if b.max <= 0 {
		return true
	}
	now := b.nowFn()
	if now.Sub(b.start) >= time.Second {
		b.start, b.used = now, 0
	}
	if b.used+n > b.max {
		return false
	}
	b.used += n
	return true
}

// Controller gestiona UNA sola sesión a la vez. Lo comparten el agente de nube
// y el servidor de red local, así la política de seguridad es idéntica.
type Controller struct {
	Opts     CaptureOptions
	ViewOnly bool

	// FullKeys: permite tecla Win y combinaciones (agente de nube).
	FullKeys bool
	// AllowTiles: habilita el envío por regiones con control de flujo (solo
	// con visores que lo declaran con {t:'caps'}; los viejos siguen recibiendo
	// JPEG completos).
	AllowTiles bool
	// Unattended: el consentimiento lo da la configuración local, sin aviso.
	Unattended bool

	// Sustituibles en pruebas.
	Consent func(ctx context.Context, viewer string) bool
	Capture func() (*image.RGBA, error)
	Size    func() (int, int, error)

	smu  sync.Mutex
	sess *Session
}

func NewController(opts CaptureOptions, viewOnly bool) *Controller {
	return &Controller{Opts: opts, ViewOnly: viewOnly, Consent: AskConsent, Capture: CaptureScreen, Size: ScreenSize}
}

func hostAndOS() (string, string) {
	host, _ := os.Hostname()
	return host, "Windows (" + runtime.GOARCH + ")"
}

// SendInfo manda al visor el tamaño de pantalla (antes de pedir consentimiento).
func (c *Controller) SendInfo(tr Transport) {
	if w, h, e := c.Size(); e == nil {
		sw, sh := ScaledSize(w, h, c.Opts.maxW())
		host, os := hostAndOS()
		tr.WriteText(proto.InfoMsg(sw, sh, host, os))
	}
}

// Start pide consentimiento local y, solo si se acepta, empieza a enviar
// pantalla. Devuelve un canal que se cierra cuando la sesión terminó
// (rechazo, corte, error de envío o fin de connCtx).
func (c *Controller) Start(connCtx context.Context, tr Transport, viewer string) <-chan struct{} {
	c.End() // una sola sesión a la vez
	ctx, cancel := context.WithCancel(connCtx)
	guard := NewKeyGuard()
	if c.FullKeys {
		guard = NewKeyGuardFull()
	}
	s := &Session{cancel: cancel, done: make(chan struct{}), viewer: viewer, viewOnly: c.ViewOnly,
		quality: DefaultQuality, guard: guard}
	if c.AllowTiles {
		s.ts = newTileStreamer(c.Opts.maxW(), c.Opts.MaxFPS)
	}
	c.smu.Lock()
	c.sess = s
	c.smu.Unlock()

	go func() {
		defer close(s.done)
		defer cancel()
		if c.Unattended {
			Logf("«%s» solicita control remoto (modo desatendido, sin aviso).", viewer)
		} else {
			Logf("«%s» solicita control remoto. Mostrando aviso…", viewer)
		}
		ok := c.Consent(ctx, viewer)
		if ctx.Err() != nil {
			c.clear(s)
			return
		}
		tr.WriteText(proto.ConsentMsgFull(ok, c.ViewOnly, c.Unattended && ok))
		if !ok {
			Logf("Solicitud rechazada (o sin respuesta en %d s).", proto.ConsentTimeout)
			c.clear(s)
			return
		}
		s.setConsented(true)
		started := time.Now()
		if c.Unattended {
			Logf("Sesión aceptada AUTOMÁTICAMENTE (modo desatendido). Usuario del sitio: «%s» — %s.", viewer, started.Format("2006-01-02 15:04:05"))
		} else {
			Logf("Sesión aceptada. Compartiendo pantalla con «%s».", viewer)
		}
		// Sin franja/overlay en pantalla durante la sesión (quitado a pedido
		// del usuario): la ventana abierta ya es el aviso. Solo queda el log.
		defer func() {
			Logf("Sesión de «%s» terminada (duró %s).", viewer, time.Since(started).Round(time.Second))
			s.setConsented(false)
			s.releaseAll()
			c.clear(s)
		}()
		c.captureLoop(ctx, s, tr, func(w, h int) {
			host, os := hostAndOS()
			tr.WriteText(proto.InfoMsg(w, h, host, os))
		})
	}()
	return s.done
}

func (c *Controller) clear(s *Session) {
	c.smu.Lock()
	if c.sess == s {
		c.sess = nil
	}
	c.smu.Unlock()
}

// Active dice si hay una sesión (pendiente de consentimiento o aceptada).
func (c *Controller) Active() bool {
	c.smu.Lock()
	defer c.smu.Unlock()
	return c.sess != nil
}

// HandleInput pasa un mensaje ya validado a la sesión actual.
func (c *Controller) HandleInput(m proto.InMsg) {
	c.smu.Lock()
	s := c.sess
	c.smu.Unlock()
	if s != nil {
		s.handleInput(m)
	}
}

// End corta la sesión actual y espera a que termine su limpieza.
func (c *Controller) End() {
	c.smu.Lock()
	s := c.sess
	c.smu.Unlock()
	if s == nil {
		return
	}
	s.cancel()
	select {
	case <-s.done:
	case <-time.After(3 * time.Second):
	}
}

// LocalCut: corte local (Ctrl+Shift+F12). notify avisa al visor antes de cortar.
func (c *Controller) LocalCut(notify func()) {
	c.smu.Lock()
	s := c.sess
	c.smu.Unlock()
	if s == nil {
		Logf("Ctrl+Shift+F12: no hay sesión que cortar.")
		return
	}
	Logf("Corte local: sesión cortada desde este equipo.")
	if notify != nil {
		notify()
	}
	c.End()
}

// captureLoop envía pantalla hasta que ctx termine. En modo regiones usa
// goroutines separadas: este bucle captura y codifica; otra goroutine escribe
// en la red (así un envío lento nunca frena la captura ni el input, que llega
// por la goroutine de lectura del agente).
func (c *Controller) captureLoop(ctx context.Context, s *Session, tr Transport, sendInfo func(w, h int)) {
	send := tr.WriteBinary
	interval := c.Opts.Interval
	if interval <= 0 {
		interval = DefaultCaptureInterval
	}
	if interval < 50*time.Millisecond {
		interval = 50 * time.Millisecond
	}
	budget := &byteBudget{max: c.Opts.MaxBytesPerSec, nowFn: time.Now}
	enc := NewFrameEncoder()
	enc.MaxW = c.Opts.maxW()

	out := make(chan []byte, 2)
	wctx, wcancel := context.WithCancel(ctx)
	defer wcancel()
	if s.ts != nil {
		go func() {
			for {
				select {
				case <-wctx.Done():
					return
				case b := <-out:
					if err := send(b); err != nil {
						s.cancel()
						return
					}
				}
			}
		}()
	}

	timer := time.NewTimer(interval)
	defer timer.Stop()
	lastSent := time.Time{}
	lw, lh := 0, 0
	var lastErrLog time.Time
	for {
		s.mu.Lock()
		tiles := s.ts != nil && s.tilesOn
		quality := s.quality
		s.mu.Unlock()
		wait := interval
		if tiles {
			wait = s.ts.interval(quality)
		}
		timer.Reset(wait)
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		img, err := c.Capture()
		if err != nil {
			if time.Since(lastErrLog) > 10*time.Second {
				Logf("Error capturando pantalla: %v", err)
				lastErrLog = time.Now()
			}
			continue
		}
		if tiles {
			pkt, nw, nh, err := s.ts.step(img, quality)
			if nw > 0 {
				sendInfo(nw, nh)
			}
			if err != nil {
				Logf("Error codificando frame: %v", err)
			}
			if pkt != nil {
				select {
				case out <- pkt:
				default:
					s.ts.forceFull() // cola de red llena: el siguiente lleva todo lo nuevo
				}
			}
			if m := s.ts.statMsg(); m != nil {
				tr.WriteText(m)
			}
			continue
		}
		if time.Since(lastSent) > 3*time.Second {
			enc.ForceNext() // refresco periódico por si el visor perdió un frame
		}
		data, w, h, doSend, err := enc.Encode(img, s.getQuality())
		if err != nil {
			Logf("Error codificando frame: %v", err)
			continue
		}
		if w != lw || h != lh {
			lw, lh = w, h
			sendInfo(w, h)
		}
		if !doSend {
			continue
		}
		if !budget.allow(len(data)) {
			enc.ForceNext() // frame descartado por el tope de bytes: reintentar luego
			continue
		}
		if err := send(data); err != nil {
			return
		}
		lastSent = time.Now()
	}
}
