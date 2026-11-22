<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiErrorMessage } from '@/api/http';
import AuthCard from '@/components/AuthCard.vue';
import { useAuthStore } from '@/stores/auth';
import { rules } from '@/utils/validation';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const email = ref('');
const password = ref('');
const showPassword = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const form = ref<{ validate: () => Promise<{ valid: boolean }> }>();

async function submit() {
  if (!(await form.value?.validate())?.valid) return;
  loading.value = true;
  error.value = null;
  try {
    await auth.login(email.value, password.value);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/videos';
    await router.replace(redirect.startsWith('/') ? redirect : '/videos');
  } catch (e) {
    error.value = apiErrorMessage(e, 'Não foi possível entrar.');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthCard title="Entrar" subtitle="Acesse para enviar vídeos e acompanhar o processamento.">
    <v-form ref="form" @submit.prevent="submit">
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">
        {{ error }}
      </v-alert>
      <v-text-field
        v-model="email"
        label="E-mail"
        type="email"
        autocomplete="email"
        prepend-inner-icon="mdi-email-outline"
        :rules="[rules.required('E-mail'), rules.email]"
        class="mb-2"
        autofocus
      />
      <v-text-field
        v-model="password"
        label="Senha"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="current-password"
        prepend-inner-icon="mdi-lock-outline"
        :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
        :rules="[rules.required('Senha')]"
        class="mb-2"
        @click:append-inner="showPassword = !showPassword"
      />
      <v-btn type="submit" color="primary" size="large" block :loading="loading">Entrar</v-btn>
    </v-form>
    <p class="text-body-2 text-center mt-6">
      Não tem conta?
      <router-link to="/cadastro" class="text-primary font-weight-medium">Criar conta</router-link>
    </p>
  </AuthCard>
</template>
