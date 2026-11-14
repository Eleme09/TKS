package main

import (
	"fmt"
	"sync"
	"time"
)

// Salida de consola con banner permanente mientras hay sesión activa.

var (
	outMu    sync.Mutex
	vtOK     bool // lo fija initConsole (true si la consola entiende ANSI)
	bannerOn bool
	bannerCh chan struct{}
)

func logf(format string, args ...any) {
	outMu.Lock()
	defer outMu.Unlock()
	fmt.Printf("%s  %s\n", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
}

func bannerText(viewer string, since time.Time) string {
	d := time.Since(since).Round(time.Second)
	return fmt.Sprintf(" SESIÓN REMOTA ACTIVA — %s controla este equipo — %02d:%02d — Ctrl+Shift+F12 o cierra esta ventana para cortar ",
		viewer, int(d.Minutes()), int(d.Seconds())%60)
}

// showBanner deja una franja roja fija arriba (región de scroll reservada)
// hasta hideBanner. Nunca se oculta sola mientras la sesión esté activa.
func showBanner(viewer string) {
	outMu.Lock()
	if bannerOn {
		outMu.Unlock()
		return
	}
	bannerOn = true
	ch := make(chan struct{})
	bannerCh = ch
	since := time.Now()
	setConsoleTitle("SESIÓN REMOTA ACTIVA — Placer")
	if vtOK {
		fmt.Print("\x1b[2J\x1b[H")
		paintBannerLocked(viewer, since)
		fmt.Print("\x1b[4;999r\x1b[4;1H")
	} else {
		fmt.Println("\n*** SESIÓN REMOTA ACTIVA — " + viewer + " controla este equipo ***\n")
	}
	outMu.Unlock()

	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		n := 0
		for {
			select {
			case <-ch:
				return
			case <-t.C:
				outMu.Lock()
				if bannerOn && bannerCh == ch {
					if vtOK {
						fmt.Print("\x1b7")
						paintBannerLocked(viewer, since)
						fmt.Print("\x1b8")
					} else if n++; n%10 == 0 {
						fmt.Println("*** SESIÓN REMOTA ACTIVA ***")
					}
				}
				outMu.Unlock()
			}
		}
	}()
}

func paintBannerLocked(viewer string, since time.Time) {
	fmt.Print("\x1b[1;1H\x1b[2K\x1b[97;41;1m" + bannerText(viewer, since) + "\x1b[0m")
}

func hideBanner() {
	outMu.Lock()
	defer outMu.Unlock()
	if !bannerOn {
		return
	}
	bannerOn = false
	if bannerCh != nil {
		close(bannerCh)
		bannerCh = nil
	}
	if vtOK {
		fmt.Print("\x1b[r\x1b[2J\x1b[H")
	}
	setConsoleTitle("Placer — agente de control remoto")
	fmt.Printf("%s  Sesión remota terminada.\n", time.Now().Format("15:04:05"))
}
