//go:build !windows

package tray

import "context"

// Start no hace nada fuera de Windows (el agente de nube solo se usa en
// Windows; este stub solo existe para que `go vet`/`go test` compilen aquí).
func (t *Tray) Start(ctx context.Context) error { return nil }

// SetState no hace nada en el stub.
func (t *Tray) SetState(status string, sessionActive bool) {}

// SetLogSource no hace nada en el stub.
func SetLogSource(f func() string) {}
