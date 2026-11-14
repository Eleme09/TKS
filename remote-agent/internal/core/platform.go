package core

// Funciones específicas del sistema operativo. Se implementan en
// *_windows.go (reales) y *_stub.go (compilan en Linux/macOS pero no hacen
// nada útil, solo existen para go vet y los tests de la parte portable).
//
//   capture_*.go : CaptureScreen(), ScreenSize()
//   input_*.go   : injectMouse(), injectKey(), releaseMouseButtons()
//   consent_*.go : AskConsent()
//   console_*.go : InitConsole(), SetConsoleTitle(), InstallLocalCut(), InstallCloseHandler()
