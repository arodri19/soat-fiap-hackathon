<script setup lang="ts">
import { config } from '@/config';

const cards = [
  {
    key: 'grafana',
    title: 'Grafana',
    desc: 'Dashboards: vídeos por status, filas, latência',
    icon: 'mdi-chart-line',
  },
  {
    key: 'rabbitmq',
    title: 'RabbitMQ',
    desc: 'Filas, retry e DLQ (fiapx / fiapx)',
    icon: 'mdi-rabbit',
  },
  {
    key: 'mailpit',
    title: 'Mailpit',
    desc: 'E-mails de falha enviados aos usuários',
    icon: 'mdi-email-fast-outline',
  },
  {
    key: 'minio',
    title: 'MinIO',
    desc: 'Vídeos enviados e zips gerados',
    icon: 'mdi-database-outline',
  },
  {
    key: 'prometheus',
    title: 'Prometheus',
    desc: 'Métricas coletadas de todos os serviços',
    icon: 'mdi-fire',
  },
] as const;

const available = cards.filter((c) => config.links[c.key]);

const steps = [
  'Criar conta e entrar (auth-service: bcrypt + JWT RS256 + refresh em cookie HttpOnly)',
  'Enviar vários vídeos de uma vez (video-api: streaming para o MinIO + outbox transacional)',
  'Acompanhar o status mudando sozinho: Na fila → Processando → Concluído',
  'Enviar um arquivo inválido e ver o erro aqui e o e-mail no Mailpit',
  'Escalar os workers (make scale n=3) e enviar um lote: processamento em paralelo',
  'Ver filas no RabbitMQ e métricas no Grafana',
];
</script>

<template>
  <div class="d-flex flex-column ga-6">
    <v-card class="pa-5">
      <h2 class="text-h6 font-weight-bold mb-1">Infraestrutura</h2>
      <p class="text-body-2 text-medium-emphasis mb-4">
        Atalhos para mostrar a solução funcionando.
      </p>
      <v-row dense>
        <v-col v-for="c in available" :key="c.key" cols="12" sm="6" md="4">
          <v-card
            :href="config.links[c.key]"
            target="_blank"
            rel="noopener"
            variant="outlined"
            class="pa-4 h-100"
          >
            <div class="d-flex align-center ga-3">
              <v-avatar color="primary" variant="tonal" rounded="lg"
                ><v-icon :icon="c.icon"
              /></v-avatar>
              <div>
                <div class="font-weight-bold">
                  {{ c.title }} <v-icon icon="mdi-open-in-new" size="14" />
                </div>
                <div class="text-caption text-medium-emphasis">{{ c.desc }}</div>
              </div>
            </div>
          </v-card>
        </v-col>
      </v-row>
      <p v-if="!available.length" class="text-medium-emphasis">Nenhum link configurado.</p>
    </v-card>

    <v-card class="pa-5">
      <h2 class="text-h6 font-weight-bold mb-4">Roteiro da demonstração</h2>
      <v-list density="comfortable" class="pa-0">
        <v-list-item v-for="(step, i) in steps" :key="i" class="px-0">
          <template #prepend>
            <v-avatar color="primary" size="28" class="mr-3"
              ><span class="text-caption">{{ i + 1 }}</span></v-avatar
            >
          </template>
          <v-list-item-title class="text-wrap">{{ step }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-card>
  </div>
</template>
