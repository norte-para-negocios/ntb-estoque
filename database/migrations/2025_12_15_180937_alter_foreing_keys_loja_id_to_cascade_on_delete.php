<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('integration_attempts') && Schema::hasColumn('integration_attempts', 'loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'integration_attempts' AND COLUMN_NAME = 'loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('integration_attempts', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('ordem_producaos') && Schema::hasColumn('ordem_producaos', 'loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordem_producaos' AND COLUMN_NAME = 'loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('ordem_producaos', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('movimentos') && Schema::hasColumn('movimentos', 'loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'movimentos' AND COLUMN_NAME = 'loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('movimentos', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('loja_user') && Schema::hasColumn('loja_user', 'loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loja_user' AND COLUMN_NAME = 'loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('loja_user', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('loja_user') && Schema::hasColumn('loja_user', 'user_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loja_user' AND COLUMN_NAME = 'user_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('loja_user', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('user_id')
                    ->references('id')
                    ->on('users')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('permissao_user') && Schema::hasColumn('permissao_user', 'loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'permissao_user' AND COLUMN_NAME = 'loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('permissao_user', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('permissao_user') && Schema::hasColumn('permissao_user', 'user_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'permissao_user' AND COLUMN_NAME = 'user_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('permissao_user', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('user_id')
                    ->references('id')
                    ->on('users')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('nfs') && Schema::hasColumn('nfs', 'loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nfs' AND COLUMN_NAME = 'loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('nfs', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('webhooks') && Schema::hasColumn('webhooks', 'loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'webhooks' AND COLUMN_NAME = 'loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('webhooks', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('inventarios') && Schema::hasColumn('inventarios', 'loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventarios' AND COLUMN_NAME = 'loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('inventarios', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('inventario_items') && Schema::hasColumn('inventario_items', 'loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventario_items' AND COLUMN_NAME = 'loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('inventario_items', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('produtos') && Schema::hasColumn('produtos', 'loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produtos' AND COLUMN_NAME = 'loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('produtos', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('local_estoques') && Schema::hasColumn('local_estoques', 'loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'local_estoques' AND COLUMN_NAME = 'loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('local_estoques', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('posicao_estoques') && Schema::hasColumn('posicao_estoques', 'loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'posicao_estoques' AND COLUMN_NAME = 'loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('posicao_estoques', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('notas_fiscais') && Schema::hasColumn('notas_fiscais', 'loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notas_fiscais' AND COLUMN_NAME = 'loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('notas_fiscais', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }

        if (Schema::hasTable('users') && Schema::hasColumn('users', 'current_loja_id')) {
            $constraint = DB::selectOne("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'current_loja_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
            Schema::table('users', function (Blueprint $table) use ($constraint) {
                if ($constraint) {
                    $table->dropForeign($constraint->CONSTRAINT_NAME);
                }
                $table->foreign('current_loja_id')
                    ->references('id')
                    ->on('lojas')
                    ->onDelete('cascade')
                    ->onUpdate('cascade');
            });
        }
    }
};
