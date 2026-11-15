package redemptionshop

import (
	"errors"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	OptionKey       = "RedemptionStoreSettings"
	maxSettingsSize = 128 << 10
)

var (
	errInvalid  = common.NewMessage("Invalid redemption store settings")
	errConflict = common.NewMessage("Redemption stores changed. Reload before saving.")
)

type Settings struct {
	Revision int64   `json:"revision"`
	Enabled  bool    `json:"enabled"`
	Stores   []Store `json:"stores"`
}

// Array order is the wallet display order, including disabled entries.
type Store struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
}

type PublicStore struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Description string `json:"description"`
}

func normalizeSettings(s Settings) (Settings, error) {
	if s.Revision < 0 || s.Revision >= 1<<53-1 || len(s.Stores) > 32 {
		return s, errInvalid
	}
	if s.Stores == nil {
		s.Stores = []Store{}
	}
	seen := make(map[string]bool, len(s.Stores))
	for i := range s.Stores {
		store := &s.Stores[i]
		store.Name = strings.TrimSpace(store.Name)
		store.URL = strings.TrimSpace(store.URL)
		store.Description = strings.TrimSpace(store.Description)
		if store.ID == "" || len(store.ID) > 100 || seen[store.ID] || store.Name == "" || utf8.RuneCountInString(store.Name) > 80 || utf8.RuneCountInString(store.Description) > 300 || len(store.URL) > 2048 {
			return s, errInvalid
		}
		for _, char := range store.ID {
			if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_') {
				return s, errInvalid
			}
		}
		u, err := url.Parse(store.URL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Opaque != "" || strings.ContainsAny(store.URL, "\\\r\n\t ") {
			return s, errInvalid
		}
		seen[store.ID] = true
	}
	encoded, err := common.Marshal(s)
	if err != nil || len(encoded) > maxSettingsSize {
		return s, errInvalid
	}
	return s, nil
}

func readSettings(db *gorm.DB) (Settings, string, error) {
	s := Settings{Stores: []Store{}}
	var option model.Option
	err := db.Where(clause.Eq{Column: "key", Value: OptionKey}).Take(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s, "", nil
	}
	if err != nil {
		return s, "", err
	}
	if len(option.Value) > maxSettingsSize || common.UnmarshalJsonStr(option.Value, &s) != nil {
		return s, "", errInvalid
	}
	s, err = normalizeSettings(s)
	return s, option.Value, err
}

func saveSettings(db *gorm.DB, s Settings) (Settings, error) {
	s, err := normalizeSettings(s)
	if err != nil {
		return s, err
	}
	var encoded []byte
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.Option{Key: OptionKey, Value: `{"revision":0,"enabled":false,"stores":[]}`}).Error; err != nil {
			return err
		}
		current, raw, err := readSettings(tx)
		if err != nil {
			return err
		}
		if current.Revision != s.Revision {
			return errConflict
		}
		s.Revision++
		encoded, err = common.Marshal(s)
		if err != nil {
			return err
		}
		result := tx.Model(&model.Option{}).Where(clause.Eq{Column: "key", Value: OptionKey}).Where("value = ?", raw).Update("value", string(encoded))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errConflict
		}
		return nil
	})
	if err != nil {
		return s, err
	}
	return s, nil
}

// PublicStores honors the host's redemption gate and publishes enabled stores
// only. It never fetches external URLs or handles payments on behalf of stores.
func PublicStores(db *gorm.DB, redemptionEnabled bool) ([]PublicStore, error) {
	stores := []PublicStore{}
	if !redemptionEnabled {
		return stores, nil
	}
	s, _, err := readSettings(db)
	if err != nil || !s.Enabled {
		return stores, err
	}
	for _, store := range s.Stores {
		if store.Enabled {
			stores = append(stores, PublicStore{ID: store.ID, Name: store.Name, URL: store.URL, Description: store.Description})
		}
	}
	return stores, nil
}
