"""Add project and user_name_pretty columns

Revision ID: 112360f07afc
Revises: 3fc0879ca72
Create Date: 2015-02-28 22:01:21.500594

"""

# revision identifiers, used by Alembic.
revision = '112360f07afc'
down_revision = '3fc0879ca72'

from alembic import op
import sqlalchemy as sa


def upgrade():
    ### commands auto generated by Alembic - please adjust! ###
    op.add_column('test_result', sa.Column('project', sa.String(length=128), nullable=True))
    op.add_column('test_result', sa.Column('user_name_pretty', sa.String(length=128), nullable=True))
    ### end Alembic commands ###


def downgrade():
    ### commands auto generated by Alembic - please adjust! ###
    op.drop_column('test_result', 'user_name_pretty')
    op.drop_column('test_result', 'project')
    ### end Alembic commands ###