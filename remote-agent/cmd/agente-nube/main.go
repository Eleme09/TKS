package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"placer/remote-agent/internal/core"
	"placer/remote-agent/internal/proto"
)

func waitEnter() {
	fmt.Println("\nPulsa Enter para salir.")
	bufio.NewReader(os.Stdin).ReadString('\n')
}

func main() {
	cfgFlag := flag.String("config", "", "ruta de config.json (por defecto, junto al .exe)")
	flag.Parse()

	core.InitConsole()
	core.BaseTitle = "Placer — agente de control remoto"
	core.SetConsoleTitle(core.BaseTitle)
	fmt.Println("==================================================================")
	fmt.Println(" Placer — agente de control remoto")
	fmt.Println(" Solo actúa si TÚ aceptas cada solicitud. Ctrl+Shift+F12 corta.")
	fmt.Println(" Esta ventana debe permanecer abierta mientras esté en uso.")
	fmt.Println("==================================================================")

	path := *cfgFlag
	if path == "" {
		exe, err := os.Executable()
		if err != nil {
			exe = os.Args[0]
		}
		path = filepath.Join(filepath.Dir(exe), "config.json")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Printf("No se pudo leer %s: %v\nCopia config.example.json como config.json y complétalo.\n", path, err)
		waitEnter()
		os.Exit(1)
	}
	cfg, err := proto.ParseConfig(data)
	if err != nil {
		fmt.Printf("Error en %s: %v\n", path, err)
		waitEnter()
		os.Exit(1)
	}
	agent, err := NewAgent(cfg)
	if err != nil {
		fmt.Println("Error:", err)
		waitEnter()
		os.Exit(1)
	}
	if cfg.AllowInsecure {
		core.Logf("AVISO: allowInsecure activo (solo para pruebas locales).")
	}

	core.InstallLocalCut(agent.LocalCut)
	core.InstallCloseHandler(agent.Shutdown)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	agent.Run(ctx)
	agent.Shutdown()
}
