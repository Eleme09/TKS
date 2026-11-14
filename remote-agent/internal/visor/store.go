package visor

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"

	"placer/remote-agent/internal/proto"
)

// Store guarda los emparejamientos importados (contienen secretos: archivo 0600).
type Store struct {
	mu    sync.Mutex
	path  string
	items []proto.Pairing
}

func OpenStore(path string) (*Store, error) {
	s := &Store{path: path}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(data, &s.items); err != nil {
		return nil, errors.New("el archivo de emparejamientos está dañado: " + path)
	}
	valid := s.items[:0]
	for _, p := range s.items {
		if p.Validate() == nil {
			valid = append(valid, p)
		}
	}
	s.items = valid
	return s, nil
}

func (s *Store) saveLocked() error {
	b, _ := json.MarshalIndent(s.items, "", "  ")
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) List() []proto.Pairing {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]proto.Pairing(nil), s.items...)
}

func (s *Store) Get(fp string) (proto.Pairing, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.items {
		if p.Fingerprint == fp {
			return p, true
		}
	}
	return proto.Pairing{}, false
}

// Add guarda el emparejamiento. Si ya había uno del mismo equipo (misma huella
// o mismo nombre, p. ej. tras rotar el secreto) lo reemplaza.
func (s *Store) Add(p proto.Pairing) error {
	if err := p.Validate(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.items) >= 100 {
		return errors.New("demasiados equipos emparejados")
	}
	kept := s.items[:0:0]
	for _, q := range s.items {
		if q.Fingerprint != p.Fingerprint && !strings.EqualFold(q.Name, p.Name) {
			kept = append(kept, q)
		}
	}
	s.items = append(kept, p)
	return s.saveLocked()
}

func (s *Store) Remove(fp string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := s.items[:0:0]
	for _, q := range s.items {
		if q.Fingerprint != fp {
			kept = append(kept, q)
		}
	}
	s.items = kept
	return s.saveLocked()
}
