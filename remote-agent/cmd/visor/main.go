// placer-visor: el que mira. Abre una página local en el navegador (127.0.0.1)
// que detecta los PCs de la red y se conecta a ellos de forma segura.
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"

	"placer/remote-agent/internal/core"
	"placer/remote-agent/internal/proto"
	"placer/remote-agent/internal/visor"
)

func fatal(format string, a ...any) {
	fmt.Printf(format+"\n", a...)
	fmt.Println("\nPulsa Enter para salir.")
	bufio.NewReader(os.Stdin).ReadString('\n')
	os.Exit(1)
}

func openBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	}
	return exec.Command("xdg-open", url).Start()
}

func main() {
	dirFlag := flag.String("dir", "", "carpeta donde se guardan los emparejamientos (por defecto, junto al .exe)")
	portFlag := flag.Int("port", 5920, "puerto local preferido")
	noOpen := flag.Bool("no-abrir", false, "no abrir el navegador")
	flag.Parse()

	core.InitConsole()
	core.SetConsoleTitle("Placer — visor de control remoto")
	fmt.Println("==================================================================")
	fmt.Println(" Placer — visor de control remoto (red local)")
	fmt.Println(" Deja esta ventana abierta mientras uses el visor.")
	fmt.Println("==================================================================")

	dir := *dirFlag
	if dir == "" {
		exe, err := os.Executable()
		if err != nil {
			exe = os.Args[0]
		}
		dir = filepath.Dir(exe)
	}
	store, err := visor.OpenStore(filepath.Join(dir, "visor-pairings.json"))
	if err != nil {
		fatal("No se pudo abrir los emparejamientos: %v", err)
	}
	// Archivos pairing.json arrastrados sobre el .exe (o pasados como argumento).
	for _, f := range flag.Args() {
		data, err := os.ReadFile(f)
		if err == nil {
			var p proto.Pairing
			if p, err = proto.ParsePairing(data); err == nil {
				err = store.Add(p)
			}
			if err == nil {
				core.Logf("Emparejado con «%s».", p.Name)
				continue
			}
		}
		core.Logf("No se pudo importar %s: %v", f, err)
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *portFlag))
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0") // puerto libre
		if err != nil {
			fatal("No se pudo abrir el visor local: %v", err)
		}
	}
	port := ln.Addr().(*net.TCPAddr).Port
	host, _ := os.Hostname()
	disc := visor.NewDiscovery()
	app := visor.NewApp(port, store, disc, "Visor en "+host)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		if err := disc.Listen(ctx, proto.AnnouncePort); err != nil {
			core.Logf("No se pudo escuchar los anuncios de la red (puerto UDP %d): %v. Aún puedes conectar escribiendo la IP.", proto.AnnouncePort, err)
		}
	}()

	url := app.URL()
	fmt.Println("\n Abre esta dirección en el navegador (solo funciona en este PC):")
	fmt.Println("   " + url)
	if !*noOpen {
		if err := openBrowser(url); err != nil {
			core.Logf("No se pudo abrir el navegador solo: %v", err)
		}
	}
	if err := app.Run(ctx, ln); err != nil {
		core.Logf("Error: %v", err)
	}
}
