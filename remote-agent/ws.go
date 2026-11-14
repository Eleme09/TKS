package main

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const writeTimeout = 10 * time.Second

// Agent mantiene la conexión con el relay y gestiona la sesión activa.
type Agent struct {
	cfg Config
	url string

	wmu  sync.Mutex
	conn *websocket.Conn

	smu  sync.Mutex
	sess *session
}

func NewAgent(cfg Config) (*Agent, error) {
	u, err := BuildAgentURL(cfg.Server, cfg.AllowInsecure)
	if err != nil {
		return nil, err
	}
	return &Agent{cfg: cfg, url: u}, nil
}

// Run conecta y reconecta con backoff hasta que ctx termine.
func (a *Agent) Run(ctx context.Context) {
	backoff := time.Second
	for ctx.Err() == nil {
		authed, err := a.connectOnce(ctx)
		if ctx.Err() != nil {
			return
		}
		if authed {
			backoff = time.Second
		}
		var ce *websocket.CloseError
		switch {
		case errors.As(err, &ce) && ce.Code == 4003:
			logf("El servidor rechazó las credenciales (device/token). Revisa config.json.")
		case errors.As(err, &ce) && ce.Code == 4006:
			logf("Este equipo fue borrado en el sitio.")
		case errors.As(err, &ce) && ce.Code == 4004:
			logf("Otro agente se conectó con este mismo equipo y reemplazó a este.")
		default:
			logf("Desconectado: %v", err)
		}
		wait := backoff + time.Duration(rand.Int63n(int64(backoff)/2+1))
		logf("Reintentando en %s…", wait.Round(time.Second))
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		if backoff < 60*time.Second {
			backoff *= 2
			if backoff > 60*time.Second {
				backoff = 60 * time.Second
			}
		}
	}
}

func (a *Agent) connectOnce(parent context.Context) (authed bool, err error) {
	d := websocket.Dialer{HandshakeTimeout: 15 * time.Second, Proxy: http.ProxyFromEnvironment}
	logf("Conectando a %s …", a.url)
	conn, _, err := d.DialContext(parent, a.url, nil)
	if err != nil {
		return false, err
	}
	conn.SetReadLimit(16 * 1024)
	ctx, cancel := context.WithCancel(parent)
	defer func() {
		cancel()
		a.endSession(false)
		a.wmu.Lock()
		a.conn = nil
		a.wmu.Unlock()
		conn.Close()
	}()
	a.wmu.Lock()
	a.conn = conn
	a.wmu.Unlock()

	if err := a.writeText(conn, authMsg(a.cfg.Device, a.cfg.Token)); err != nil {
		return false, err
	}
	conn.SetReadDeadline(time.Now().Add(15 * time.Second))
	for {
		mt, data, err := conn.ReadMessage()
		if err != nil {
			return false, err
		}
		if mt != websocket.TextMessage {
			continue
		}
		m, perr := parseIn(data)
		if perr == nil && m.T == "authok" {
			break
		}
	}
	conn.SetReadDeadline(time.Time{})
	authed = true
	logf("Conectado y autenticado (equipo %s). Esperando solicitudes (no se comparte nada hasta que aceptes).", a.cfg.Device)

	host, _ := os.Hostname()
	if w, h, e := screenSize(); e == nil {
		sw, sh := ScaledSize(w, h, maxFrameWidth)
		a.writeText(conn, infoMsg(sw, sh, host, "Windows ("+runtime.GOARCH+")"))
	}

	go func() { // ping de aplicación cada 30 s
		t := time.NewTicker(pingEverySec * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if a.writeText(conn, pingMsg()) != nil {
					conn.Close()
					return
				}
			}
		}
	}()
	go func() { <-ctx.Done(); conn.Close() }()

	for {
		mt, data, err := conn.ReadMessage()
		if err != nil {
			return authed, err
		}
		if mt != websocket.TextMessage {
			continue
		}
		m, perr := parseIn(data)
		if perr != nil {
			continue
		}
		switch m.T {
		case "session_start":
			a.startSession(ctx, conn, SanitizeViewer(m.Viewer))
		case "session_end":
			a.endSession(false)
		case "mouse", "key", "quality":
			a.smu.Lock()
			s := a.sess
			a.smu.Unlock()
			if s != nil {
				s.handleInput(m)
			}
		}
	}
}

func (a *Agent) writeText(conn *websocket.Conn, b []byte) error {
	a.wmu.Lock()
	defer a.wmu.Unlock()
	conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	return conn.WriteMessage(websocket.TextMessage, b)
}

func (a *Agent) writeBinary(conn *websocket.Conn, b []byte) error {
	a.wmu.Lock()
	defer a.wmu.Unlock()
	conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	return conn.WriteMessage(websocket.BinaryMessage, b)
}

// startSession pide consentimiento local y, solo si se acepta, empieza a enviar pantalla.
func (a *Agent) startSession(connCtx context.Context, conn *websocket.Conn, viewer string) {
	a.endSession(false) // una sola sesión a la vez
	ctx, cancel := context.WithCancel(connCtx)
	s := &session{cancel: cancel, done: make(chan struct{}), viewer: viewer, quality: defaultQuality, guard: NewKeyGuard()}
	a.smu.Lock()
	a.sess = s
	a.smu.Unlock()

	go func() {
		defer close(s.done)
		defer cancel()
		logf("«%s» solicita control remoto. Mostrando aviso…", viewer)
		ok := askConsent(ctx, viewer)
		if ctx.Err() != nil {
			return
		}
		a.writeText(conn, consentMsg(ok))
		if !ok {
			logf("Solicitud rechazada (o sin respuesta en %d s).", consentTimeout)
			a.clear(s)
			return
		}
		s.setConsented(true)
		logf("Sesión aceptada. Compartiendo pantalla con «%s».", viewer)
		showBanner(viewer)
		defer func() {
			s.setConsented(false)
			s.releaseAll()
			hideBanner()
			a.clear(s)
		}()
		s.captureLoop(ctx,
			func(b []byte) error { return a.writeBinary(conn, b) },
			func(w, h int) {
				host, _ := os.Hostname()
				a.writeText(conn, infoMsg(w, h, host, "Windows ("+runtime.GOARCH+")"))
			})
	}()
}

func (a *Agent) clear(s *session) {
	a.smu.Lock()
	if a.sess == s {
		a.sess = nil
	}
	a.smu.Unlock()
}

// endSession corta la sesión actual y espera a que termine su limpieza.
func (a *Agent) endSession(_ bool) {
	a.smu.Lock()
	s := a.sess
	a.smu.Unlock()
	if s == nil {
		return
	}
	s.cancel()
	select {
	case <-s.done:
	case <-time.After(3 * time.Second):
	}
}

// LocalCut: corte local (Ctrl+Shift+F12). Avisa al relay con consent=false,
// que cierra la sesión del visor.
func (a *Agent) LocalCut() {
	a.smu.Lock()
	s := a.sess
	a.smu.Unlock()
	if s == nil {
		logf("Ctrl+Shift+F12: no hay sesión que cortar.")
		return
	}
	logf("Corte local: sesión cortada desde este equipo.")
	a.wmu.Lock()
	c := a.conn
	a.wmu.Unlock()
	if c != nil {
		a.writeText(c, consentMsg(false))
	}
	a.endSession(true)
}

// Shutdown: al cerrar la ventana/Ctrl+C. Corta y cierra la conexión.
func (a *Agent) Shutdown() {
	a.LocalCut()
	a.wmu.Lock()
	c := a.conn
	a.wmu.Unlock()
	if c != nil {
		c.Close()
	}
	fmt.Println()
}
