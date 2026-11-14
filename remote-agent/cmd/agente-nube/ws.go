package main

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"placer/remote-agent/internal/core"
	"placer/remote-agent/internal/proto"
)

const writeTimeout = 10 * time.Second

// Agent mantiene la conexión con el relay y gestiona la sesión activa.
type Agent struct {
	cfg proto.Config
	url string

	wmu  sync.Mutex
	conn *websocket.Conn

	ctrl *core.Controller
}

func NewAgent(cfg proto.Config) (*Agent, error) {
	u, err := proto.BuildAgentURL(cfg.Server, cfg.AllowInsecure)
	if err != nil {
		return nil, err
	}
	return &Agent{cfg: cfg, url: u, ctrl: core.NewController(core.CaptureOptions{}, false)}, nil
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
			core.Logf("El servidor rechazó las credenciales (device/token). Revisa config.json.")
		case errors.As(err, &ce) && ce.Code == 4006:
			core.Logf("Este equipo fue borrado en el sitio.")
		case errors.As(err, &ce) && ce.Code == 4004:
			core.Logf("Otro agente se conectó con este mismo equipo y reemplazó a este.")
		default:
			core.Logf("Desconectado: %v", err)
		}
		wait := backoff + time.Duration(rand.Int63n(int64(backoff)/2+1))
		core.Logf("Reintentando en %s…", wait.Round(time.Second))
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
	core.Logf("Conectando a %s …", a.url)
	conn, _, err := d.DialContext(parent, a.url, nil)
	if err != nil {
		return false, err
	}
	conn.SetReadLimit(16 * 1024)
	ctx, cancel := context.WithCancel(parent)
	defer func() {
		cancel()
		a.ctrl.End()
		a.wmu.Lock()
		a.conn = nil
		a.wmu.Unlock()
		conn.Close()
	}()
	a.wmu.Lock()
	a.conn = conn
	a.wmu.Unlock()

	if err := a.writeText(conn, proto.AuthMsg(a.cfg.Device, a.cfg.Token)); err != nil {
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
		m, perr := proto.ParseIn(data)
		if perr == nil && m.T == "authok" {
			break
		}
	}
	conn.SetReadDeadline(time.Time{})
	authed = true
	core.Logf("Conectado y autenticado (equipo %s). Esperando solicitudes (no se comparte nada hasta que aceptes).", a.cfg.Device)

	a.ctrl.SendInfo(a.transport(conn))

	go func() { // ping de aplicación cada 30 s
		t := time.NewTicker(proto.PingEverySec * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if a.writeText(conn, proto.PingMsg()) != nil {
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
		m, perr := proto.ParseIn(data)
		if perr != nil {
			continue
		}
		switch m.T {
		case "session_start":
			a.ctrl.Start(ctx, a.transport(conn), proto.SanitizeViewer(m.Viewer))
		case "session_end":
			a.ctrl.End()
		case "mouse", "key", "quality":
			a.ctrl.HandleInput(m)
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

func (a *Agent) transport(conn *websocket.Conn) core.Transport {
	return core.Transport{
		WriteText:   func(b []byte) error { return a.writeText(conn, b) },
		WriteBinary: func(b []byte) error { return a.writeBinary(conn, b) },
	}
}

// LocalCut: corte local (Ctrl+Shift+F12). Avisa al relay con consent=false,
// que cierra la sesión del visor.
func (a *Agent) LocalCut() {
	a.ctrl.LocalCut(func() {
		a.wmu.Lock()
		c := a.conn
		a.wmu.Unlock()
		if c != nil {
			a.writeText(c, proto.ConsentMsg(false, false))
		}
	})
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
