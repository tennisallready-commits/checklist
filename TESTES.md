# Testes automatizados

Os testes abrem o aplicativo em um navegador real, com dados isolados e sem acessar a conta de produção.

## Preparação

```bash
npm install
npx playwright install chromium
```

## Executar

```bash
npm test
```

A suíte cobre inicialmente criação e persistência de tarefas, conclusão com um clique, confirmação especial de treino e visibilidade de treinos colaborativos.
