package messaging_test

import (
	"testing"

	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/stretchr/testify/assert"

	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/messaging"
)

const queue = "processor.video-requested"

func TestAttemptFromXDeath(t *testing.T) {
	assert.Equal(t, 1, messaging.Attempt(nil, queue), "primeira entrega")

	// Depois de 2 rejeições: a mensagem passou 2x pela fila de retry e voltou
	headers := amqp.Table{"x-death": []any{
		amqp.Table{"queue": "processor.video-requested.retry", "reason": "expired", "count": int64(2)},
		amqp.Table{"queue": queue, "reason": "rejected", "count": int64(2)},
	}}
	assert.Equal(t, 3, messaging.Attempt(headers, queue))

	other := amqp.Table{"x-death": []any{
		amqp.Table{"queue": "outra-fila", "reason": "rejected", "count": int64(5)},
	}}
	assert.Equal(t, 1, messaging.Attempt(other, queue), "só conta rejeições da fila do worker")

	assert.Equal(t, 2, messaging.Attempt(amqp.Table{"x-death": []any{
		amqp.Table{"queue": queue, "reason": "rejected", "count": int32(1)},
	}}, queue))
	assert.Equal(t, 1, messaging.Attempt(amqp.Table{"x-death": "inválido"}, queue))
}
