// placer-servidor: se instala en el PC al que se quieren conectar (red local).
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"placer/remote-agent/internal/core"
	"placer/remote-agent/internal/lanserver"
)

func waitEnter() {
	fmt.Println("\nPulsa Enter para salir.")
	bufio.NewReader(os.Stdin).ReadString('\n')
}

func fatal(format string, a ...any) {
	fmt.Printf(format+"\n", a...)
	waitEnter()
	os.Exit(1)
}

func main() {
	cfgFlag := flag.String("config", "", "ruta de config.json (por defecto, junto al .exe)")
	flag.Parse()

	core.InitConsole()
	core.BaseTitle = "Placer — servidor de control remoto (red local)"
	core.SetConsoleTitle(core.BaseTitle)
	fmt.Println("==================================================================")
	fmt.Println(" Placer — servidor de control remoto (red local)")
	fmt.Println(" Solo actúa si TÚ aceptas cada solicitud. Ctrl+Shift+F12 corta.")
	fmt.Println(" Esta ventana debe permanecer abierta mientras esté en uso.")
	fmt.Println("==================================================================")

	exe, err := os.Executable()
	if err != nil {
		exe = os.Args[0]
	}
	dir := filepath.Dir(exe)
	cfgPath := *cfgFlag
	if cfgPath == "" {
		cfgPath = filepath.Join(dir, "config.json")
	} else {
		dir = filepath.Dir(cfgPath)
	}
	data, err := os.ReadFile(cfgPath)
	if err != nil && !os.IsNotExist(err) {
		fatal("No se pudo leer %s: %v", cfgPath, err)
	}
	host, _ := os.Hostname()
	cfg, err := lanserver.ParseConfig(data, host)
	if err != nil {
		fatal("Error en %s: %v", cfgPath, err)
	}

	id, err := lanserver.LoadOrCreateIdentity(dir, cfg.Name, cfg.Port)
	if err != nil {
		fatal("No se pudo preparar el emparejamiento: %v", err)
	}
	if id.Created {
		fmt.Println()
		fmt.Println(" PRIMER ARRANQUE — se creó el archivo de emparejamiento:")
		fmt.Println("   " + filepath.Join(dir, lanserver.PairingFile))
		fmt.Println(" Cópialo UNA vez (USB o carpeta segura) al PC del visor y ábrelo con")
		fmt.Println(" placer-visor.exe (o arrástralo a su ventana). Es la llave: no lo compartas.")
		fmt.Println(" Para cambiar la llave: cierra esto, borra pairing.json y vuelve a abrir.")
	}
	// Si el puerto o nombre cambiaron, pairing.json conserva los del primer arranque.
	if id.Pairing.Port != cfg.Port {
		core.Logf("AVISO: config.json dice puerto %d pero pairing.json dice %d. Borra pairing.json para regenerarlo.", cfg.Port, id.Pairing.Port)
	}

	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.Port))
	if err != nil {
		fatal("No se pudo abrir el puerto %d (¿ya hay otro servidor abierto?): %v", cfg.Port, err)
	}
	fmt.Printf("\n Escuchando en el puerto TCP %d (TLS 1.3). Direcciones de este PC:\n", cfg.Port)
	for _, ip := range lanserver.LocalIPs() {
		fmt.Printf("   %s:%d\n", ip, cfg.Port)
	}
	if cfg.ViewOnly {
		fmt.Println(" Modo SOLO VER: el visor no puede mover mouse ni teclado.")
	}
	if len(cfg.AllowedViewerIPs) > 0 {
		fmt.Printf(" Solo aceptan conexiones estas IP: %v\n", cfg.AllowedViewerIPs)
	}
	fmt.Println()

	ctrl := core.NewController(core.CaptureOptions{Interval: 125 * time.Millisecond, MaxBytesPerSec: 4 * 1024 * 1024}, cfg.ViewOnly)
	srv := lanserver.New(cfg, id, ctrl)
	core.InstallLocalCut(srv.LocalCut)
	core.InstallCloseHandler(srv.Shutdown)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if cfg.AnnounceEnabled() {
		go lanserver.RunAnnouncer(ctx, cfg.Name, cfg.Port, nil)
		core.Logf("Anunciándose en la red como «%s».", cfg.Name)
	} else {
		core.Logf("Anuncio en la red desactivado: el visor debe conectar escribiendo la IP.")
	}
	core.Logf("Esperando conexiones (no se comparte nada hasta que aceptes).")
	if err := srv.Serve(ctx, ln); err != nil {
		core.Logf("Error: %v", err)
	}
	srv.Shutdown()
}
