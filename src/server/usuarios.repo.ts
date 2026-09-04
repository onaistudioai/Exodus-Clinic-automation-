import "server-only";
import type { Tx } from "@/lib/db";

/**
 * DAL — equipe da clínica (Wave 3 do onboarding).
 *
 * `senha_hash` NUNCA sai daqui: não está em nenhum SELECT, em nenhum tipo, em
 * nenhuma prop de componente. O único lugar que lê a coluna é
 * `fn_login_lookup`, SECURITY DEFINER, que existe exatamente para isso.
 *
 * A autorização real destas escritas mora no banco: a policy RESTRICTIVE
 * `rls_papel_gerir_usuarios_{ins,upd}` (acesso-016) exige a ação
 * `gerir_usuarios` em `papel_acao` para o papel da sessão. O `requireAcao()`
 * na action é a segunda camada — ele dá a mensagem de erro boa, mas quem nega
 * de verdade é a policy. Se algum dia as duas discordarem, a policy vence, e é
 * assim que tem de ser.
 */

export interface UsuarioDaEquipe {
  id: number;
  nome: string;
  email: string | null;
  papel: string;
  ativo: boolean;
}

export interface PapelDisponivel {
  chave: string;
  rotulo: string;
}

/**
 * Papéis atribuíveis, LIDOS DA TABELA — nunca de literal no TypeScript.
 * `usuarios.papel` é FK para `papel.chave` desde a acesso-016: oferecer no
 * formulário algo que não esteja aqui produz erro de FK, não um usuário torto.
 */
export async function papeisDisponiveis(tx: Tx): Promise<PapelDisponivel[]> {
  const { rows } = await tx.query<PapelDisponivel>(
    `SELECT chave, rotulo FROM papel ORDER BY ordem`
  );
  return rows;
}

export async function listar(tx: Tx): Promise<UsuarioDaEquipe[]> {
  const { rows } = await tx.query<UsuarioDaEquipe>(
    `SELECT id, nome, email, papel, ativo
       FROM usuarios
      ORDER BY ativo DESC, nome`
  );
  return rows;
}

/**
 * `clinica_id` sai do GUC, nunca de parâmetro — mesma razão de `withTenant()`
 * ler a sessão por dentro em vez de aceitar o papel de quem chama: um id vindo
 * de fora é um id que alguém pode trocar.
 */
export async function criar(
  tx: Tx,
  u: { nome: string; email: string; senhaHash: string; papel: string }
): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO usuarios (clinica_id, nome, papel, email, senha_hash, ativo)
          VALUES (current_setting('app.clinica_id')::int, $1, $2, $3, $4, true)
       RETURNING id`,
    [u.nome, u.papel, u.email, u.senhaHash]
  );
  return rows[0].id;
}

/**
 * Desativa. NÃO deleta: `app_painel` não tem `DELETE` em nenhuma tabela do
 * schema, por design (o modelo é append-only). `fn_login_lookup` já filtra
 * `ativo = true`, então desativar barra o login no mesmo instante.
 */
export async function definirAtivo(tx: Tx, id: number, ativo: boolean): Promise<boolean> {
  const { rowCount } = await tx.query(`UPDATE usuarios SET ativo = $2 WHERE id = $1`, [
    id,
    ativo,
  ]);
  return (rowCount ?? 0) > 0;
}

/** Hash atual de um usuário, só para conferir a senha antiga na troca própria. */
export async function hashDe(tx: Tx, id: number): Promise<string | null> {
  const { rows } = await tx.query<{ senha_hash: string | null }>(
    `SELECT senha_hash FROM usuarios WHERE id = $1 AND ativo`,
    [id]
  );
  return rows[0]?.senha_hash ?? null;
}

/**
 * Troca a própria senha. O `id` vem SEMPRE da sessão no caller, nunca do
 * formulário — senão isto vira "trocar a senha de qualquer um".
 */
export async function trocarSenha(tx: Tx, id: number, senhaHash: string): Promise<boolean> {
  const { rowCount } = await tx.query(
    `UPDATE usuarios SET senha_hash = $2 WHERE id = $1 AND ativo`,
    [id, senhaHash]
  );
  return (rowCount ?? 0) > 0;
}
