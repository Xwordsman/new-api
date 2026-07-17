package invitation

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, Migrate(db))
	return db
}

func TestMigrateCreatesDisabledSettings(t *testing.T) {
	db := newTestDB(t)

	enabled, err := RegistrationEnabled(db)
	require.NoError(t, err)
	assert.False(t, enabled)
	require.NoError(t, Consume(db, ""))
}

func TestConsumeEnforcesUsageLimit(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, UpdateSettings(db, true))
	require.NoError(t, db.Create(&Code{
		Code:    "LIMITED-CODE",
		Status:  CodeStatusEnabled,
		MaxUses: 1,
	}).Error)

	require.NoError(t, Consume(db, " limited-code "))
	err := Consume(db, "LIMITED-CODE")
	assert.ErrorIs(t, err, ErrCodeExhausted)

	var code Code
	require.NoError(t, db.Where("code = ?", "LIMITED-CODE").First(&code).Error)
	assert.Equal(t, 1, code.UsedCount)
}

func TestConsumeRejectsUnavailableCodes(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, UpdateSettings(db, true))
	past := time.Now().Add(-time.Hour)

	tests := []struct {
		name string
		code Code
		err  error
	}{
		{
			name: "disabled",
			code: Code{Code: "DISABLED-CODE", Status: CodeStatusDisabled},
			err:  ErrCodeDisabled,
		},
		{
			name: "expired",
			code: Code{Code: "EXPIRED-CODE", Status: CodeStatusEnabled, ExpiresAt: &past},
			err:  ErrCodeExpired,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.NoError(t, db.Create(&test.code).Error)
			assert.ErrorIs(t, Consume(db, test.code.Code), test.err)
		})
	}

	assert.ErrorIs(t, Consume(db, "MISSING-CODE"), ErrCodeInvalid)
	assert.ErrorIs(t, Consume(db, ""), ErrCodeRequired)
}

func TestConsumeRollsBackWithRegistrationTransaction(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, UpdateSettings(db, true))
	require.NoError(t, db.Create(&Code{
		Code:    "ROLLBACK-CODE",
		Status:  CodeStatusEnabled,
		MaxUses: 1,
	}).Error)

	errRollback := errors.New("registration failed")
	err := db.Transaction(func(tx *gorm.DB) error {
		require.NoError(t, Consume(tx, "ROLLBACK-CODE"))
		return errRollback
	})
	assert.ErrorIs(t, err, errRollback)

	var code Code
	require.NoError(t, db.Where("code = ?", "ROLLBACK-CODE").First(&code).Error)
	assert.Zero(t, code.UsedCount)
}
