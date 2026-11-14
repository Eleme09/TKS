//go:build !windows

package core

func InitConsole()           { vtOK = true }
func SetConsoleTitle(string) {}

// En no-Windows no hay tecla global ni manejador de cierre (solo Ctrl+C vía señal en main).
func InstallLocalCut(func())     {}
func InstallCloseHandler(func()) {}
