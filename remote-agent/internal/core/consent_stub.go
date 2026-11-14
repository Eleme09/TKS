//go:build !windows

package core

import "context"

// En plataformas que no son Windows nunca se acepta nada.
func AskConsent(ctx context.Context, viewer string) bool { return false }
