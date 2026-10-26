"""lotes con varios productos

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-27

Mueve producto y cantidades de `batches` a la nueva tabla `batch_items`; cada lote existente
queda con un único ítem.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'batch_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('batch_id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('planned_quantity', sa.Integer(), nullable=False),
        sa.Column('produced_quantity', sa.Integer(), nullable=True),
        sa.Column('defective_quantity', sa.Integer(), nullable=False),
        sa.Column('estimated_unit_cost', sa.Float(), nullable=False, server_default='0'),
        sa.CheckConstraint('planned_quantity > 0', name='ck_batch_item_planned'),
        sa.ForeignKeyConstraint(['batch_id'], ['batches.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.execute(
        'INSERT INTO batch_items (batch_id, product_id, planned_quantity, produced_quantity, defective_quantity) '
        'SELECT id, product_id, planned_quantity, produced_quantity, defective_quantity FROM batches'
    )
    with op.batch_alter_table('batches') as batch_op:
        batch_op.drop_column('product_id')
        batch_op.drop_column('planned_quantity')
        batch_op.drop_column('produced_quantity')
        batch_op.drop_column('defective_quantity')


def downgrade() -> None:
    # Al volver atrás, cada lote conserva solo su primer producto
    with op.batch_alter_table('batches') as batch_op:
        batch_op.add_column(sa.Column('product_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('planned_quantity', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('produced_quantity', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('defective_quantity', sa.Integer(), nullable=True))
    op.execute(
        'UPDATE batches SET '
        'product_id = (SELECT product_id FROM batch_items i WHERE i.batch_id = batches.id ORDER BY i.id LIMIT 1), '
        'planned_quantity = (SELECT planned_quantity FROM batch_items i WHERE i.batch_id = batches.id ORDER BY i.id LIMIT 1), '
        'produced_quantity = (SELECT produced_quantity FROM batch_items i WHERE i.batch_id = batches.id ORDER BY i.id LIMIT 1), '
        'defective_quantity = (SELECT defective_quantity FROM batch_items i WHERE i.batch_id = batches.id ORDER BY i.id LIMIT 1)'
    )
    op.execute('DELETE FROM batches WHERE product_id IS NULL')
    with op.batch_alter_table('batches') as batch_op:
        batch_op.alter_column('product_id', nullable=False)
        batch_op.alter_column('planned_quantity', nullable=False)
        batch_op.alter_column('defective_quantity', nullable=False)
        batch_op.create_foreign_key('batches_product_id_fkey', 'products', ['product_id'], ['id'], ondelete='RESTRICT')
    op.drop_table('batch_items')
