package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// Relay falso: comprueba el handshake (auth → authok), session_start y que,
// sin consentimiento posible (stub no-Windows rechaza), el agente responde consent ok=false.
func TestAgentProtocolAgainstFakeRelay(t *testing.T) {
	got := make(chan map[string]any, 8)
	up := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != agentPath {
			http.NotFound(w, r)
			return
		}
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		_, data, _ := c.ReadMessage()
		var auth map[string]any
		json.Unmarshal(data, &auth)
		got <- auth
		c.WriteMessage(websocket.TextMessage, []byte(`{"t":"authok","name":"pc"}`))
		c.WriteMessage(websocket.TextMessage, []byte(`{"t":"session_start","viewer":"Elemee"}`))
		for {
			_, data, err := c.ReadMessage()
			if err != nil {
				return
			}
			var m map[string]any
			json.Unmarshal(data, &m)
			got <- m
		}
	}))
	defer srv.Close()

	cfg := Config{Server: strings.Replace(srv.URL, "http://", "ws://", 1), Device: "dev", Token: "tok", AllowInsecure: true}
	a, err := NewAgent(cfg)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go a.Run(ctx)

	auth := <-got
	if auth["t"] != "auth" || auth["device"] != "dev" || auth["token"] != "tok" {
		t.Fatalf("auth: %v", auth)
	}
	deadline := time.After(5 * time.Second)
	for {
		select {
		case m := <-got:
			if m["t"] == "consent" {
				if m["ok"] != false {
					t.Fatalf("consent debía ser false: %v", m)
				}
				return
			}
		case <-deadline:
			t.Fatal("no llegó consent")
		}
	}
}
