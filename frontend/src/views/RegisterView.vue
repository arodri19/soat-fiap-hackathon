<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiErrorMessage } from '@/api/http';
import AuthCard from '@/components/AuthCard.vue';
import { useAuthStore } from '@/stores/auth';
import { useNotifyStore } from '@/stores/notify';
import { passwordRule, passwordStrength, rules } from '@/utils/validation';

const auth = useAuthStore();
const notify = useNotifyStore();
const router = useRouter();

const name = ref('');
const email = ref('');
const password = ref('');
const confirm = ref('');
const showPassword = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const form = ref<{ validate: () => Promise<{ valid: boolean }> }>();

const strength = computed(() => passwordStrength(password.value));
const strengthInfo = computed(
  () =>
    [
      { label: 'Muito fraca', color: 'error' },
      { label: 'Fraca', color: 'error' },
      { label: 'Razoável', color: 'warning' },
      { label: 'Boa', color: 'success' },
      { label: 'Forte', color: 'success' },
    ][strength.value],
);
const sameAsPassword = (v: string) => v === password.value || 'As senhas não conferem';

async function submit() {
  if (!(await form.value?.validate())?.valid) return;
  loading.value = true;
  error.value = null;
  try {
    await auth.register(name.value, email.value, password.value);
    notify.success('Conta criada! Bem-vindo(a).');
    await router.replace('/videos');
  } catch (e) {
    error.value = apiErrorMessage(e, 'Não foi possível criar a conta.');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthCard title="Criar conta" subtitle="Leva menos de um minuto.">
    <v-form ref="form" @submit.prevent="submit">
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">
        {{ error }}
      </v-alert>
      <v-text-field
        v-model="name"
        label="Nome"
        autocomplete="name"
        prepend-inner-icon="mdi-account-outline"
        :rules="[rules.required('Nome'), rules.minLength(2, 'Nome')]"
        class="mb-2"
        autofocus
      />
      <v-text-field
        v-model="email"
        label="E-mail"
        type="email"
        autocomplete="email"
        prepend-inner-icon="mdi-email-outline"
        :rules="[rules.required('E-mail'), rules.email]"
        class="mb-2"
      />
      <v-text-field
        v-model="password"
        label="Senha"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="new-password"
        prepend-inner-icon="mdi-lock-outline"
        :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
        :rules="[passwordRule]"
        hint="Mínimo 8 caracteres, com letra e número"
        persistent-hint
        @click:append-inner="showPassword = !showPassword"
      />
      <div v-if="password" class="d-flex align-center ga-2 mt-2 mb-1">
        <v-progress-linear
          :model-value="(strength / 4) * 100"
          :color="strengthInfo.color"
          height="6"
          rounded
        />
        <span class="text-caption" style="min-width: 80px">{{ strengthInfo.label }}</span>
      </div>
      <v-text-field
        v-model="confirm"
        label="Confirmar senha"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="new-password"
        prepend-inner-icon="mdi-lock-check-outline"
        :rules="[rules.required('Confirmação'), sameAsPassword]"
        class="mt-4 mb-2"
      />
      <v-btn type="submit" color="primary" size="large" block :loading="loading">Criar conta</v-btn>
    </v-form>
    <p class="text-body-2 text-center mt-6">
      Já tem conta?
      <router-link to="/login" class="text-primary font-weight-medium">Entrar</router-link>
    </p>
  </AuthCard>
</template>
