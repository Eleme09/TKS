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
)

func waitEnter() {
	fmt.Println("\nPulsa Enter para salir.")
	bufio.NewReader(os.Stdin).ReadString('\n')
}

func main() {
	cfgFlag := flag.String("config", "", "ruta de config.json (por defecto, junto al .exe)")
	flag.Parse()

	initConsole()
	setConsoleTitle("Placer — agente de control remoto")
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
	cfg, err := ParseConfig(data)
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
		logf("AVISO: allowInsecure activo (solo para pruebas locales).")
	}

	installLocalCut(agent.LocalCut)
	installCloseHandler(agent.Shutdown)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	agent.Run(ctx)
	agent.Shutdown()
}
