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
	"placer/remote-agent/internal/tray"
)

// waitEnter: solo tiene sentido si hay una consola real que lea stdin. Con
// -H=windowsgui (icono de bandeja, sin consola) se usa fatal() en su lugar.
func waitEnter() {
	fmt.Println("\nPulsa Enter para salir.")
	bufio.NewReader(os.Stdin).ReadString('\n')
}

// fatal: muestra el error como pueda (consola si la hay, si no un cuadro de
// diálogo) y termina. Nunca deja el proceso colgado esperando una consola
// que no existe.
func fatal(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	if core.HasConsole() {
		fmt.Println(msg)
		waitEnter()
	} else {
		core.FatalBox("Placer — agente de control remoto", msg)
	}
	os.Exit(1)
}

func main() {
	cfgFlag := flag.String("config", "", "ruta de config.json (por defecto, junto al .exe)")
	flag.Parse()

	core.InitConsole()
	core.BaseTitle = "Placer — agente de control remoto"
	core.SetConsoleTitle(core.BaseTitle)

	exe, exeErr := os.Executable()
	if exeErr != nil {
		exe = os.Args[0]
	}
	dir := filepath.Dir(exe)
	if err := core.EnableFileLog(filepath.Join(dir, "log.txt")); err != nil && core.HasConsole() {
		fmt.Println("AVISO: no se pudo abrir log.txt:", err)
	}

	core.Logf("Placer — agente de control remoto. Por defecto solo actúa si TÚ aceptas cada solicitud. Ctrl+Shift+F12 corta.")
	core.Logf("El programa queda como icono en la bandeja del sistema (junto al reloj/wifi). Clic derecho para el menú, 'Salir' para terminarlo del todo.")

	path := *cfgFlag
	if path == "" {
		path = filepath.Join(dir, "config.json")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		fatal("No se pudo leer %s: %v\nCopia config.example.json como config.json y complétalo.", path, err)
	}
	cfg, err := proto.ParseConfig(data)
	if err != nil {
		fatal("Error en %s: %v", path, err)
	}
	if cfg.Unattended {
		core.Logf("MODO DESATENDIDO ACTIVO (config.json): este equipo acepta sesiones remotas SIN preguntar. Ctrl+Shift+F12 corta una sesión al instante.")
	}
	agent, err := NewAgent(cfg)
	if err != nil {
		fatal("Error: %v", err)
	}
	if cfg.AllowInsecure {
		core.Logf("AVISO: allowInsecure activo (solo para pruebas locales).")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	tr := tray.New("Placer — agente de control remoto")
	tr.OnCloseSession = agent.LocalCut
	tr.OnQuit = func() {
		agent.Shutdown()
		stop()
		os.Exit(0)
	}
	tray.SetLogSource(core.RecentLog)
	if err := tr.Start(ctx); err != nil {
		// Sin icono no hay forma de que alguien vea el programa salvo el
		// Administrador de tareas — seguimos funcionando igual (el agente
		// no depende del icono), solo queda constancia en el registro.
		core.Logf("AVISO: no se pudo crear el icono de bandeja: %v", err)
	}
	agent.StatusFn = tr.SetState

	core.InstallLocalCut(agent.LocalCut)
	core.InstallCloseHandler(agent.Shutdown)

	agent.Run(ctx)
	agent.Shutdown()
}
