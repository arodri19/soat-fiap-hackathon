<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useDisplay, useTheme } from 'vuetify';
import { persistTheme } from '@/plugins/vuetify';
import { useAuthStore } from '@/stores/auth';
import { useVideosStore } from '@/stores/videos';

const auth = useAuthStore();
const videos = useVideosStore();
const router = useRouter();
const theme = useTheme();
const { mdAndUp } = useDisplay();
const drawer = ref(mdAndUp.value);

function toggleTheme() {
  const next = theme.global.current.value.dark ? 'light' : 'dark';
  theme.global.name.value = next;
  persistTheme(next);
}

async function logout() {
  await auth.logout().catch(() => undefined);
  videos.reset();
  await router.push('/login');
}

const initials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
</script>

<template>
  <v-navigation-drawer v-model="drawer" :permanent="mdAndUp" width="240">
    <div class="d-flex align-center ga-3 pa-4">
      <v-avatar color="primary" rounded="lg" size="36"><strong>X</strong></v-avatar>
      <div>
        <div class="text-subtitle-1 font-weight-bold">FIAP X</div>
        <div class="text-caption text-medium-emphasis">Processador de vídeos</div>
      </div>
    </div>
    <v-divider />
    <v-list nav density="comfortable">
      <v-list-item to="/videos" prepend-icon="mdi-movie-open-play-outline" title="Meus vídeos" />
      <v-list-item to="/infraestrutura" prepend-icon="mdi-monitor-dashboard" title="Infraestrutura" />
    </v-list>
  </v-navigation-drawer>

  <v-app-bar flat border="b">
    <v-app-bar-nav-icon v-if="!mdAndUp" aria-label="Menu" @click="drawer = !drawer" />
    <v-app-bar-title class="text-body-1 font-weight-medium">
      {{ $route.meta.title }}
    </v-app-bar-title>
    <v-btn
      :icon="theme.global.current.value.dark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
      :aria-label="theme.global.current.value.dark ? 'Tema claro' : 'Tema escuro'"
      @click="toggleTheme"
    />
    <v-menu location="bottom end">
      <template #activator="{ props }">
        <v-btn v-bind="props" class="mr-2" variant="text" rounded="pill">
          <v-avatar color="primary" variant="tonal" size="30" class="mr-2">
            <span class="text-caption font-weight-bold">{{ initials(auth.user?.name) }}</span>
          </v-avatar>
          <span class="d-none d-sm-inline">{{ auth.user?.name }}</span>
        </v-btn>
      </template>
      <v-list density="compact" min-width="220">
        <v-list-item :title="auth.user?.name" :subtitle="auth.user?.email" />
        <v-divider />
        <v-list-item prepend-icon="mdi-logout" title="Sair" @click="logout" />
      </v-list>
    </v-menu>
  </v-app-bar>

  <v-main>
    <v-container class="py-6" style="max-width: 1200px">
      <slot />
    </v-container>
  </v-main>
</template>
